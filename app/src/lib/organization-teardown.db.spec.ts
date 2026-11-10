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
const getState = jest.fn();
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ subscriptions: { revoke }, customers: { getState } }) }));
const deletePrefix = jest.fn(async (): Promise<{ success: boolean; failedObjects: unknown[] }> => ({ success: true, failedObjects: [] }));
const deleteReports = jest.fn(async () => ({ success: true, failedObjects: [] }));
const getRunArtifactInputs = jest.fn((): unknown[] => []);
jest.mock("@/lib/s3-cleanup", () => ({
  createS3CleanupService: () => ({ deletePrefix, deleteReports, getRunArtifactInputs, bucket: (n: string) => n, destroy: jest.fn() }),
}));
const deleteScheduledMonitor = jest.fn(async () => true);
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor, scheduleMonitor: jest.fn() }));
const deleteScheduledJob = jest.fn(async () => true);
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob }));
import { BillingCancellationError, OrganizationMembershipChangedError, StorageCleanupError, TEARDOWN_ACTION, deleteOrganizationCompletely, soleMemberOrganizations } from "./organization-teardown";

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

let adminId: string;
beforeAll(async () => {
  const [admin] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "Admin", email: `${randomUUID()}@example.test` }).returning();
  adminId = admin.id;
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
  await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });

  expect(revoke).toHaveBeenCalledTimes(1);
  expect(deleteScheduledJob).toHaveBeenCalledWith(job.id);
  expect(deleteScheduledMonitor).toHaveBeenCalledWith(monitor.id);
  expect(deletePrefix).toHaveBeenCalledWith("requirementsBucketName", `projects/${project.id}/`);
  expect(deletePrefix).toHaveBeenCalledWith("statusBucketName", `status-pages/${page.id}/`);
  expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.projects).where(eq(schema.projects.organizationId, organization.id))).toHaveLength(0);
  expect(await mockDatabase.select().from(schema.runs).where(eq(schema.runs.projectId, project.id))).toHaveLength(0);
  const audit = await mockDatabase.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, organization.id));
  // The seeded row is kept, and the teardown marker carries the subscription id for the billing webhooks.
  expect(audit.map((row) => row.action).sort()).toEqual([TEARDOWN_ACTION, "seeded"].sort());
  expect((audit.find((row) => row.action === TEARDOWN_ACTION)?.details as { subscriptionId?: string }).subscriptionId).toBe(organization.subscriptionId);
});

function usageEvent(organizationId: string, billingPeriodEnd: Date) {
  return {
    organizationId, eventType: "playwright_execution" as const, eventName: "playwright_minutes", units: "1.5000",
    unitType: "minutes", billingPeriodStart: new Date(billingPeriodEnd.getTime() - 30 * 86_400_000), billingPeriodEnd,
  };
}

describe("final usage before the immediate cancellation", () => {
  const ingest = jest.fn();
  beforeAll(() => { global.fetch = ingest as unknown as typeof fetch; });
  afterEach(() => ingest.mockReset());

  it("sends unsynced usage to Polar before revoking", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.update(schema.organization).set({ polarCustomerId: `cus-${randomUUID()}` }).where(eq(schema.organization.id, organization.id));
    await mockDatabase.insert(schema.usageEvents).values(usageEvent(organization.id, new Date(Date.now() + 86_400_000)));
    ingest.mockResolvedValue(new Response(JSON.stringify({ inserted: 1, duplicates: 0 })));
    revoke.mockImplementationOnce(async () => {
      expect(ingest).toHaveBeenCalledTimes(1);
      const rows = await mockDatabase.select().from(schema.usageEvents).where(eq(schema.usageEvents.organizationId, organization.id));
      expect(rows[0].syncedToPolar).toBe(true);
    });

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(String(ingest.mock.calls[0][0])).toContain("/v1/events/ingest");
  });

  it("refuses to delete while a closed-period usage event is parked for manual reconciliation", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.update(schema.organization).set({ polarCustomerId: `cus-${randomUUID()}` }).where(eq(schema.organization.id, organization.id));
    await mockDatabase.insert(schema.usageEvents).values(usageEvent(organization.id, new Date(Date.now() - 86_400_000)));

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toThrow(BillingCancellationError);
    expect(revoke).not.toHaveBeenCalled();
    expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(1);
    // The evidence is untouched.
    expect(await mockDatabase.select().from(schema.usageEvents).where(eq(schema.usageEvents.organizationId, organization.id))).toHaveLength(1);
  });

  it("refuses to delete while a Polar-rejected usage event is parked", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.update(schema.organization).set({ polarCustomerId: `cus-${randomUUID()}` }).where(eq(schema.organization.id, organization.id));
    await mockDatabase.insert(schema.usageEvents).values({ ...usageEvent(organization.id, new Date(Date.now() + 86_400_000)), syncError: "Rejected by Polar; manual reconciliation required" });

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toThrow(BillingCancellationError);
    expect(revoke).not.toHaveBeenCalled();
    expect(await mockDatabase.select().from(schema.usageEvents).where(eq(schema.usageEvents.organizationId, organization.id))).toHaveLength(1);
  });

  it("refuses to delete while an execution receipt is unsettled, and deletes once it is settled", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.update(schema.organization).set({ polarCustomerId: `cus-${randomUUID()}` }).where(eq(schema.organization.id, organization.id));
    const receiptId = randomUUID();
    await mockDatabase.insert(schema.executionUsageReceipts).values({
      id: receiptId, organizationId: organization.id, runId: randomUUID(), eventType: "playwright_execution", units: "1.0000",
      billingPeriodStart: new Date(Date.now() - 86_400_000), billingPeriodEnd: new Date(Date.now() + 86_400_000),
    });

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toThrow(/not billed/);
    expect(revoke).not.toHaveBeenCalled();
    expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(1);

    await mockDatabase.update(schema.executionUsageReceipts).set({ settledAt: new Date() }).where(eq(schema.executionUsageReceipts.id, receiptId));
    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });
  });

  it("neither revokes nor deletes when usage cannot be sent", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.update(schema.organization).set({ polarCustomerId: `cus-${randomUUID()}` }).where(eq(schema.organization.id, organization.id));
    await mockDatabase.insert(schema.usageEvents).values(usageEvent(organization.id, new Date(Date.now() + 86_400_000)));
    ingest.mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toBeInstanceOf(BillingCancellationError);
    expect(revoke).not.toHaveBeenCalled();
    // The flush runs before the file sweep, so a billing outage leaves stored files in place too.
    expect(deletePrefix).not.toHaveBeenCalled();
    expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(1);
  });

  it("does not block deletion on usage that has no billing customer to go to", async () => {
    const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
    await mockDatabase.insert(schema.usageEvents).values(usageEvent(organization.id, new Date(Date.now() + 86_400_000)));

    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });
    expect(ingest).not.toHaveBeenCalled();
  });
});

it("changes nothing when the subscription cannot be cancelled", async () => {
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  revoke.mockRejectedValueOnce(Object.assign(new Error("Polar down"), { statusCode: 500 }));
  await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toBeInstanceOf(BillingCancellationError);
  const [project] = await mockDatabase.select().from(schema.projects).where(eq(schema.projects.organizationId, organization.id));
  expect(project.status).toBe("active");
  // The audit marker rolled back with the transaction.
  expect(await mockDatabase.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, TEARDOWN_ACTION))).not.toContainEqual(
    expect.objectContaining({ organizationId: organization.id }),
  );
});

it("treats an already cancelled subscription as done and skips orgs without one", async () => {
  const paid = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  revoke.mockRejectedValueOnce(Object.assign(new Error("AlreadyCanceledSubscription"), { statusCode: 403 }));
  await expect(deleteOrganizationCompletely(paid.organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });
  revoke.mockClear();
  const free = await seed();
  await deleteOrganizationCompletely(free.organization.id, { noMembers: true }, adminId);
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

it("refuses, changing nothing, when someone else became a member", async () => {
  const [owner] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "O", email: `${randomUUID()}@example.test` }).returning();
  const [joiner] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "J", email: `${randomUUID()}@example.test` }).returning();
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  await mockDatabase.insert(schema.member).values([
    { organizationId: organization.id, userId: owner.id, role: "org_owner", createdAt: new Date() },
    { organizationId: organization.id, userId: joiner.id, role: "project_viewer", createdAt: new Date() },
  ]);
  await expect(deleteOrganizationCompletely(organization.id, { onlyMemberUserId: owner.id }, adminId)).rejects.toBeInstanceOf(OrganizationMembershipChangedError);
  expect(revoke).not.toHaveBeenCalled();
  expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(1);
});

it("pages through more runs than one batch", async () => {
  const { organization, project } = await seed();
  await mockDatabase.insert(schema.runs).values(Array.from({ length: 450 }, () => ({ projectId: project.id })));
  await deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId);
  // 451 runs in batches of 200: every run's artifacts are collected exactly once.
  const seen = getRunArtifactInputs.mock.calls.map((call) => (call as unknown as [{ id: string }])[0].id);
  expect(seen).toHaveLength(451);
  expect(new Set(seen).size).toBe(451);
});

it("deletes nothing from the database when stored files cannot be removed, so a retry can finish", async () => {
  const { organization, project } = await seed();
  deletePrefix.mockResolvedValueOnce({ success: false, failedObjects: [{ key: "k", error: "denied" }] });
  await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toBeInstanceOf(StorageCleanupError);
  expect(await mockDatabase.select().from(schema.projects).where(eq(schema.projects.id, project.id))).toHaveLength(1);
  await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toEqual({ subscriptionCancelled: false });
  expect(await mockDatabase.select().from(schema.projects).where(eq(schema.projects.id, project.id))).toHaveLength(0);
});

it("ends a bound subscription even when it is stored locally as none (trialing or paused at the provider)", async () => {
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "none" });
  await deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId);
  expect(revoke).toHaveBeenCalledWith(organization.subscriptionId);
});

it("makes a member join wait until the teardown commits, then fail on the missing organization", async () => {
  const [joiner] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "J", email: `${randomUUID()}@example.test` }).returning();
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  let releaseRevoke!: () => void;
  revoke.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRevoke = resolve; }));
  const teardown = deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId);
  await new Promise((resolve) => setTimeout(resolve, 200)); // teardown now holds the row lock, waiting on the provider

  const join = client.begin(async (sql) => {
    await sql`SET LOCAL lock_timeout = '300ms'`;
    await sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${randomUUID()}, ${organization.id}, ${joiner.id}, 'project_viewer', now())`;
  });
  await expect(join).rejects.toThrow(/lock timeout/i);

  releaseRevoke();
  await expect(teardown).resolves.toEqual({ subscriptionCancelled: true });
});

it("sweeps a run's folder in every run bucket when its artifact URL cannot be parsed", async () => {
  const { organization, project } = await seed();
  const [run] = await mockDatabase.select().from(schema.runs).where(eq(schema.runs.projectId, project.id));
  getRunArtifactInputs.mockImplementationOnce(() => { throw new Error("unrecognised URL"); });
  await deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId);
  for (const bucket of ["jobBucketName", "testBucketName", "k6JobBucketName", "k6TestBucketName"]) {
    expect(deletePrefix).toHaveBeenCalledWith(bucket, `${run.id}/`);
  }
});

it("leaves the subscription untouched when storage cleanup fails", async () => {
  const { organization } = await seed({ subscriptionId: `sub-${randomUUID()}`, subscriptionStatus: "active" });
  deletePrefix.mockResolvedValueOnce({ success: false, failedObjects: [{ key: "k" }] });
  const error = await deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(StorageCleanupError);
  expect(revoke).not.toHaveBeenCalled();
});

it("lets an owner delete an organization that has other members, and refuses a non-owner", async () => {
  const [owner] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "O", email: `${randomUUID()}@example.test` }).returning();
  const [viewer] = await mockDatabase.insert(schema.user).values({ id: randomUUID(), name: "V", email: `${randomUUID()}@example.test` }).returning();
  const { organization } = await seed();
  await mockDatabase.insert(schema.member).values([
    { organizationId: organization.id, userId: owner.id, role: "org_owner", createdAt: new Date() },
    { organizationId: organization.id, userId: viewer.id, role: "project_viewer", createdAt: new Date() },
  ]);
  await expect(deleteOrganizationCompletely(organization.id, { ownerUserId: viewer.id }, viewer.id)).rejects.toBeInstanceOf(OrganizationMembershipChangedError);
  await expect(deleteOrganizationCompletely(organization.id, { ownerUserId: owner.id }, owner.id)).resolves.toEqual({ subscriptionCancelled: false });
  expect(await mockDatabase.select().from(schema.member).where(eq(schema.member.organizationId, organization.id))).toHaveLength(0);
});

describe("a subscription the billing webhook has not stored yet", () => {
  async function seedPending() {
    const { organization } = await seed();
    const polarCustomerId = `cus-${randomUUID()}`;
    await mockDatabase.update(schema.organization).set({ polarCustomerId }).where(eq(schema.organization.id, organization.id));
    return { organization, polarCustomerId };
  }

  it("ends the customer's active subscription tagged to this organization", async () => {
    const { organization, polarCustomerId } = await seedPending();
    getState.mockResolvedValue({ active_subscriptions: [
      { id: "sub-mine", metadata: { referenceId: organization.id } },
      { id: "sub-other-org", metadata: { referenceId: randomUUID() } },
    ] });
    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: true });
    expect(getState).toHaveBeenCalledWith(polarCustomerId);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("sub-mine");
  });

  it("refuses to delete when a subscription cannot be attributed to this organization", async () => {
    const { organization } = await seedPending();
    getState.mockResolvedValue({ active_subscriptions: [{ id: "sub-legacy", metadata: {} }] });
    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toThrow(BillingCancellationError);
    expect(revoke).not.toHaveBeenCalled();
    expect(await mockDatabase.select().from(schema.organization).where(eq(schema.organization.id, organization.id))).toHaveLength(1);
  });

  it("refuses to delete when the provider lookup fails", async () => {
    const { organization } = await seedPending();
    getState.mockRejectedValue(new Error("unavailable"));
    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).rejects.toThrow(BillingCancellationError);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("deletes without a cancellation when the customer has no active subscription", async () => {
    const { organization } = await seedPending();
    getState.mockResolvedValue({ active_subscriptions: [] });
    await expect(deleteOrganizationCompletely(organization.id, { noMembers: true }, adminId)).resolves.toMatchObject({ subscriptionCancelled: false });
    expect(revoke).not.toHaveBeenCalled();
  });
});
