/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the real FK graph lets an organization
// with projects, jobs, runs, monitors and status pages be deleted, and that audit history is kept.
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
const revoke = jest.fn();
jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: () => true,
  getPolarConfig: () => ({ accessToken: "t", server: "sandbox" }),
}));
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ subscriptions: { revoke } }) }));
const deletePrefix = jest.fn(async () => ({ success: true, failedObjects: [] }));
const deleteReports = jest.fn(async () => ({ success: true, failedObjects: [] }));
jest.mock("@/lib/s3-cleanup", () => ({
  createS3CleanupService: () => ({ deletePrefix, deleteReports, getRunArtifactInputs: () => [], bucket: (n: string) => n }),
}));
const deleteScheduledMonitor = jest.fn(async () => true);
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor, scheduleMonitor: jest.fn() }));
const deleteScheduledJob = jest.fn(async () => true);
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob }));
import { BillingCancellationError, deleteOrganizationCompletely, soleMemberOrganizations } from "./organization-teardown";

const name = `org_teardown_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
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

async function seed(subscription: { subscriptionId?: string; subscriptionStatus?: "active" | "none" } = {}) {
  const [organization] = await mockDatabase.insert(schema.organization)
    .values({ name: "Org", createdAt: new Date(), ...subscription }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  const [job] = await mockDatabase.insert(schema.jobs)
    .values({ organizationId: organization.id, projectId: project.id, name: "J", jobType: "playwright", cronSchedule: "*/5 * * * *" }).returning();
  await mockDatabase.insert(schema.runs).values({ projectId: project.id, jobId: job.id });
  const [monitor] = await mockDatabase.insert(schema.monitors)
    .values({ organizationId: organization.id, projectId: project.id, name: "M", type: "http_request", target: "https://example.com", frequencyMinutes: 5 }).returning();
  const [page] = await mockDatabase.insert(schema.statusPages)
    .values({ organizationId: organization.id, projectId: project.id, name: "S", subdomain: randomUUID().replaceAll("-", "") }).returning();
  await mockDatabase.insert(schema.auditLogs).values({ organizationId: organization.id, action: "seeded" });
  return { organization, project, job, monitor, page };
}

it("deletes the organization and everything it owns, keeping audit history", async () => {
  const { organization, project, job, monitor, page } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  await expect(deleteOrganizationCompletely(organization.id)).resolves.toEqual({ s3Failures: 0 });

  expect(revoke).toHaveBeenCalledTimes(1);
  expect(deleteScheduledJob).toHaveBeenCalledWith(job.id);
  expect(deleteScheduledMonitor).toHaveBeenCalledWith(monitor.id);
  expect(deletePrefix).toHaveBeenCalledWith("requirementsBucketName", `projects/${project.id}/`);
  expect(deletePrefix).toHaveBeenCalledWith("statusBucketName", `status-pages/${page.id}/`);
  expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.projects).where(eq(schema.projects.organizationId, organization.id))).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.runs).where(eq(schema.runs.projectId, project.id))).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, organization.id))).toHaveLength(1);
});

it("changes nothing when the subscription cannot be cancelled", async () => {
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  revoke.mockRejectedValueOnce(Object.assign(new Error("Polar down"), { statusCode: 500 }));
  await expect(deleteOrganizationCompletely(organization.id)).rejects.toBeInstanceOf(BillingCancellationError);
  const [project] = await mockDatabase.select().from(schema.projects).where(eq(schema.projects.organizationId, organization.id));
  expect(project.status).toBe("active");
  expect(deleteScheduledJob).not.toHaveBeenCalled();
});

it("treats an already cancelled subscription as done and skips orgs without one", async () => {
  const paid = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  revoke.mockRejectedValueOnce(Object.assign(new Error("AlreadyCanceledSubscription"), { statusCode: 403 }));
  await expect(deleteOrganizationCompletely(paid.organization.id)).resolves.toEqual({ s3Failures: 0 });
  revoke.mockClear();
  const free = await seed();
  await deleteOrganizationCompletely(free.organization.id);
  expect(revoke).not.toHaveBeenCalled();
});

it("lists only organizations where the user is the only member", async () => {
  const [u1] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "A", email: `${randomUUID()}@example.test` }).returning();
  const [u2] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "B", email: `${randomUUID()}@example.test` }).returning();
  const solo = (await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" })).organization;
  const shared = (await seed()).organization;
  await mockDatabase.insert(schema.member).values([
    { organizationId: solo.id, userId: u1.id, role: "org_owner", createdAt: new Date() },
    { organizationId: shared.id, userId: u1.id, role: "org_owner", createdAt: new Date() },
    { organizationId: shared.id, userId: u2.id, role: "project_viewer", createdAt: new Date() },
  ]);
  expect(await soleMemberOrganizations(u1.id)).toEqual([{ id: solo.id, name: "Org", hasActiveSubscription: true }]);
});
