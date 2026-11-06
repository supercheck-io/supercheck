/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the downgrade sweep's SQL against the real schema.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
const deleteScheduledMonitor = jest.fn(async () => true);
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor }));
jest.mock("@/lib/audit-actor", () => ({ getAuditActor: async () => null }));
import { PLAN_CAP_AUDIT_ACTION, enforcePlanResourceCaps } from "./plan-caps";

const name = `plan_caps_${randomUUID().replaceAll("-", "")}`;
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
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

beforeEach(() => jest.clearAllMocks());

async function limitsFor(plan: "plus" | "pro") {
  const [row] = await mockDatabase.select().from(schema.planLimits).where(eq(schema.planLimits.plan, plan));
  return row;
}

async function seed(plan: "plus" | "pro", monitorCount: number, publishedPages: number, status: "active" | "none" = "active") {
  const [organization] = await mockDatabase.insert(schema.organization).values({
    name: "Org", createdAt: new Date(), subscriptionPlan: status === "none" ? null : plan, subscriptionStatus: status,
    polarCustomerId: `cus-${randomUUID()}`, subscriptionId: `sub-${randomUUID()}`,
  }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  const base = Date.now() - 1_000_000;
  const monitorRows = monitorCount ? await mockDatabase.insert(schema.monitors).values(
    Array.from({ length: monitorCount }, (_, i) => ({
      organizationId: organization.id, projectId: project.id, name: `M${i}`, type: "http_request" as const,
      target: "https://example.com", frequencyMinutes: 5, status: "up" as const, createdAt: new Date(base + i * 1000),
    })),
  ).returning() : [];
  const pageRows = publishedPages ? await mockDatabase.insert(schema.statusPages).values(
    Array.from({ length: publishedPages }, (_, i) => ({
      organizationId: organization.id, projectId: project.id, name: `S${i}`, subdomain: randomUUID().replaceAll("-", ""),
      status: "published" as const, createdAt: new Date(base + i * 1000),
    })),
  ).returning() : [];
  return { organization, monitorRows, pageRows };
}

it("pauses the newest monitors and archives the newest pages above a downgraded plan, once", async () => {
  const plus = await limitsFor("plus");
  const { organization, monitorRows, pageRows } = await seed("plus", plus.maxMonitors + 2, plus.maxStatusPages + 1);

  const result = await enforcePlanResourceCaps();
  expect(result).toMatchObject({ monitorsPaused: 2, statusPagesArchived: 1 });

  const newest = monitorRows.slice(-2).map((row) => row.id);
  const paused = await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.status, "paused"));
  expect(paused.map((row) => row.id).sort()).toEqual(newest.sort());
  const [archived] = await mockDatabase.select().from(schema.statusPages).where(inArray(schema.statusPages.id, pageRows.map((p) => p.id)))
    .then((rows) => rows.filter((row) => row.status === "archived"));
  expect(archived.id).toBe(pageRows[pageRows.length - 1].id);
  expect(deleteScheduledMonitor).toHaveBeenCalledWith(newest[0]);
  const audit = await mockDatabase.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, organization.id));
  expect(audit.map((row) => row.action)).toEqual([PLAN_CAP_AUDIT_ACTION]);
  // Nothing is deleted; trial restore must not resume these.
  expect(await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.organizationId, organization.id))).toHaveLength(plus.maxMonitors + 2);
  expect(await mockDatabase.select().from(schema.trialSuspensions).where(eq(schema.trialSuspensions.organizationId, organization.id))).toEqual([]);

  await expect(enforcePlanResourceCaps()).resolves.toMatchObject({ monitorsPaused: 0, statusPagesArchived: 0 });
});

it("leaves organizations within their plan and lapsed organizations alone", async () => {
  const pro = await limitsFor("pro");
  const plus = await limitsFor("plus");
  const within = await seed("pro", plus.maxMonitors + 1, 1);
  const lapsed = await seed("plus", plus.maxMonitors + 1, 0, "none");
  expect(pro.maxMonitors).toBeGreaterThan(plus.maxMonitors);

  await enforcePlanResourceCaps();
  const pausedIds = (await mockDatabase.select().from(schema.monitors).where(eq(schema.monitors.status, "paused"))).map((row) => row.id);
  for (const row of [...within.monitorRows, ...lapsed.monitorRows]) expect(pausedIds).not.toContain(row.id);
});
