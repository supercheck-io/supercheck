/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the plan-cap counting predicates and the
// lock-serialized resume against the real schema.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true }));
const mockPlan = { id: "plus", plan: "plus", maxMonitors: 2, maxStatusPages: 1 };
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { getOrganizationPlan: async () => mockPlan },
}));
import { checkResumeWithinPlan, countPlanMonitors, withResumeWithinPlan } from "./plan-enforcement";

const name = `plan_enf_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

async function seedOrg() {
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  return { organization, project };
}

function monitor(organizationId: string, projectId: string, status: "up" | "paused" = "up") {
  return { organizationId, projectId, name: "M", type: "http_request" as const, target: "https://example.com", frequencyMinutes: 5, status };
}

function page(organizationId: string, projectId: string, status: "published" | "draft" | "archived") {
  return { organizationId, projectId, name: "S", subdomain: randomUUID().replaceAll("-", ""), status };
}

describe("monitor counting predicate", () => {
  it("counts only this organization's non-paused monitors in live projects", async () => {
    const { organization, project } = await seedOrg();
    const other = await seedOrg();
    const [deletedProject] = await mockDatabase.insert(schema.projects)
      .values({ organizationId: organization.id, name: "Gone", status: "deleted" }).returning();
    await mockDatabase.insert(schema.monitors).values([
      monitor(organization.id, project.id),
      monitor(organization.id, project.id, "paused"),
      monitor(organization.id, deletedProject.id),
      monitor(other.organization.id, other.project.id),
    ]);
    expect(await countPlanMonitors(mockDatabase, organization.id)).toBe(1);
  });
});

describe("checkResumeWithinPlan predicates", () => {
  it("allows a resume below the limit and denies at it, ignoring other orgs, deleted projects and paused monitors", async () => {
    const { organization, project } = await seedOrg();
    const other = await seedOrg();
    const [deletedProject] = await mockDatabase.insert(schema.projects)
      .values({ organizationId: organization.id, name: "Gone", status: "deleted" }).returning();
    await mockDatabase.insert(schema.monitors).values([
      monitor(other.organization.id, other.project.id),
      monitor(other.organization.id, other.project.id),
      monitor(organization.id, deletedProject.id),
      monitor(organization.id, project.id, "paused"),
      monitor(organization.id, project.id),
    ]);
    await expect(checkResumeWithinPlan(organization.id, "monitor")).resolves.toEqual({ allowed: true });

    await mockDatabase.insert(schema.monitors).values(monitor(organization.id, project.id));
    await expect(checkResumeWithinPlan(organization.id, "monitor")).resolves.toMatchObject({ allowed: false, limit: 2, upgrade: "pro" });
  });

  it("counts only published status pages of live projects in this organization", async () => {
    const { organization, project } = await seedOrg();
    const other = await seedOrg();
    const [deletedProject] = await mockDatabase.insert(schema.projects)
      .values({ organizationId: organization.id, name: "Gone", status: "deleted" }).returning();
    await mockDatabase.insert(schema.statusPages).values([
      page(other.organization.id, other.project.id, "published"),
      page(organization.id, deletedProject.id, "published"),
      page(organization.id, project.id, "draft"),
      page(organization.id, project.id, "archived"),
    ]);
    await expect(checkResumeWithinPlan(organization.id, "status_page")).resolves.toEqual({ allowed: true });

    await mockDatabase.insert(schema.statusPages).values(page(organization.id, project.id, "published"));
    await expect(checkResumeWithinPlan(organization.id, "status_page")).resolves.toMatchObject({ allowed: false, limit: 1 });
  });
});

describe("withResumeWithinPlan", () => {
  it("lets only one of several simultaneous resumes take the last monitor slot", async () => {
    const { organization, project } = await seedOrg();
    const rows = await mockDatabase.insert(schema.monitors).values([
      monitor(organization.id, project.id),
      monitor(organization.id, project.id, "paused"),
      monitor(organization.id, project.id, "paused"),
      monitor(organization.id, project.id, "paused"),
    ]).returning();
    const paused = rows.filter((row) => row.status === "paused");

    const results = await Promise.all(paused.map((row) =>
      withResumeWithinPlan(organization.id, "monitor", (tx) =>
        tx.update(schema.monitors).set({ status: "up" }).where(eq(schema.monitors.id, row.id)).returning())));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const denied = results.filter((result) => !result.ok);
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({ denied: { allowed: false, limit: 2 } });
    expect(await countPlanMonitors(mockDatabase, organization.id)).toBe(2);
  });

  it("lets only one of several simultaneous publishes take the last status page slot", async () => {
    const { organization, project } = await seedOrg();
    const rows = await mockDatabase.insert(schema.statusPages).values([
      page(organization.id, project.id, "draft"),
      page(organization.id, project.id, "draft"),
      page(organization.id, project.id, "archived"),
    ]).returning();

    const results = await Promise.all(rows.map((row) =>
      withResumeWithinPlan(organization.id, "status_page", (tx) =>
        tx.update(schema.statusPages).set({ status: "published" }).where(eq(schema.statusPages.id, row.id)).returning())));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const published = await mockDatabase.select().from(schema.statusPages).where(eq(schema.statusPages.organizationId, organization.id));
    expect(published.filter((row) => row.status === "published")).toHaveLength(1);
  });

  it("does not write when the plan has no slot", async () => {
    const { organization, project } = await seedOrg();
    await mockDatabase.insert(schema.monitors).values([monitor(organization.id, project.id), monitor(organization.id, project.id)]);
    const write = jest.fn();
    await expect(withResumeWithinPlan(organization.id, "monitor", write)).resolves.toMatchObject({ ok: false });
    expect(write).not.toHaveBeenCalled();
  });
});
