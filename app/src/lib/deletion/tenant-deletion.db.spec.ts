/** @jest-environment node */
// Needs TEST_DATABASE_URL (npm run test:db). Real migrations, real Postgres; storage, schedulers, Redis, billing, email and audit are mocked.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
const queries: string[] = [];
const mockDeleteReports = jest.fn();
const mockDeletePrefix = jest.fn();
const mockUnscheduleJob = jest.fn();
const mockUnscheduleMonitor = jest.fn();
const mockSignal = jest.fn();
const mockTrigger = jest.fn();
const mockPolarGet = jest.fn();
const mockPolarUpdate = jest.fn();
const mockPolarRevoke = jest.fn();
const mockFlush = jest.fn();
const mockSend = jest.fn();
const mockAudit = jest.fn();
const mockAdminAudit = jest.fn();
let mockEmailConfigured = false;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/s3-cleanup", () => ({
  createS3CleanupService: () => ({
    getRunArtifactInputs: () => [], deleteReports: (...a: unknown[]) => mockDeleteReports(...a),
    deletePrefix: (...a: unknown[]) => mockDeletePrefix(...a), bucket: (n: string) => n, destroy: () => undefined,
  }),
}));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: (...a: unknown[]) => mockUnscheduleJob(...a), scheduleJob: jest.fn().mockResolvedValue("sched") }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: (...a: unknown[]) => mockUnscheduleMonitor(...a), removeScheduledMonitor: (...a: unknown[]) => mockUnscheduleMonitor(...a) }));
jest.mock("@/lib/monitor-schedule-reconcile", () => ({ reconcileMonitorSchedule: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/execution/trial-lifecycle", () => ({ unscheduleMonitors: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/cancellation-service", () => ({ RUN_CANCELLATION_MARKER: "Cancellation requested by user", setCancellationSignal: (...a: unknown[]) => mockSignal(...a) }));
jest.mock("./queue", () => ({ triggerDeletion: (...a: unknown[]) => mockTrigger(...a) }));
jest.mock("@/lib/billing/polar-client", () => ({
  createPolarClient: () => ({
    subscriptions: { get: (...a: unknown[]) => mockPolarGet(...a), update: (...a: unknown[]) => mockPolarUpdate(...a), revoke: (...a: unknown[]) => mockPolarRevoke(...a) },
    customers: { getState: jest.fn().mockResolvedValue({ active_subscriptions: [] }) },
  }),
}));
jest.mock("@/lib/services/polar-usage.service", () => ({ polarUsageService: { flushOrganizationUsage: (...a: unknown[]) => mockFlush(...a) }, CLOSED_USAGE_PERIOD_ERROR: "closed" }));
jest.mock("@/lib/email-service", () => ({
  isEmailConfigured: () => mockEmailConfigured,
  EmailService: { getInstance: () => ({ sendEmailToMultiple: (...a: unknown[]) => mockSend(...a) }) },
}));
jest.mock("@/lib/email-renderer", () => ({ renderOrganizationDeletionEmail: async (p: { kind: string }) => ({ subject: `s-${p.kind}`, html: "h", text: "t" }) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => mockAudit(...a), logAdminEvent: (...a: unknown[]) => mockAdminAudit(...a) }));
process.env.DELETION_BATCH_PAUSE_MS = "0";
import { cancelOrganizationDeletion, continueQuiescing, purgeOrganizationNow, requestOrganizationDeletion, retryPendingBillingCancels } from "./organization";
import { restoreProject, softDeleteProject } from "./project";
import { runDeletion } from "./runner";
import { enqueueOrphanedDeletions } from "./jobs";
import { sendDueReminders } from "./notices";
import { clearDeletionStateCache, isOrgPendingDeletion, isProjectDeleted } from "./org-state";

const name = `tenant_deletion_${randomUUID().replaceAll("-", "")}`;
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
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
  });
  client = postgres(target.toString(), { max: 8, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema, logger: { logQuery: (q) => { queries.push(q); } } });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const ok = { success: true, failedObjects: [] };
beforeEach(async () => {
  await client`UPDATE deletion_jobs SET state = 'completed' WHERE state <> 'completed'`;
  await client`UPDATE organization SET deletion_requested_at = NULL, deletion_purge_after = NULL WHERE deletion_requested_at IS NOT NULL`; // earlier tests' pending orgs must not join sweeps
  for (const m of [mockDeleteReports, mockDeletePrefix, mockUnscheduleJob, mockUnscheduleMonitor, mockSignal, mockTrigger, mockPolarGet, mockPolarUpdate, mockPolarRevoke, mockFlush, mockSend, mockAudit, mockAdminAudit]) m.mockReset();
  mockAudit.mockResolvedValue(undefined);
  mockAdminAudit.mockResolvedValue(undefined);
  mockDeleteReports.mockResolvedValue(ok);
  mockDeletePrefix.mockResolvedValue(ok);
  mockUnscheduleJob.mockResolvedValue(true);
  mockUnscheduleMonitor.mockResolvedValue(true);
  mockSignal.mockResolvedValue(undefined);
  mockTrigger.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue({ synced: 0, pending: 0 });
  mockSend.mockResolvedValue({ sentCount: 1, skippedAddresses: [] });
  mockEmailConfigured = false;
  process.env.SELF_HOSTED = "true";
  Reflect.deleteProperty(process.env, "POLAR_ACCESS_TOKEN");
  clearDeletionStateCache();
  queries.length = 0;
});

async function seedOrg(options: { projects?: number; subscription?: string } = {}) {
  const [owner] = await mockDatabase.insert(schema.user).values({ name: "Owner", email: `${randomUUID()}@example.test` }).returning();
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Acme", createdAt: new Date(), ...(options.subscription ? { subscriptionId: options.subscription, polarCustomerId: `cus_${randomUUID()}`, subscriptionPlan: "plus", subscriptionStatus: "active" } : {}) }).returning();
  await mockDatabase.insert(schema.member).values({ organizationId: org.id, userId: owner.id, role: "org_owner", createdAt: new Date() });
  const projectIds: string[] = [];
  for (let i = 0; i < (options.projects ?? 1); i++) {
    const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: `P${i}`, isDefault: i === 0 }).returning();
    projectIds.push(project.id);
  }
  return { orgId: org.id, ownerId: owner.id, projectId: projectIds[0], projectIds };
}

async function seedJob(orgId: string, projectId: string, runCount: number) {
  const [job] = await mockDatabase.insert(schema.jobs).values({ organizationId: orgId, projectId, name: "Job" }).returning();
  await client`INSERT INTO runs (id, job_id, project_id, status, trigger) SELECT uuidv7(), ${job.id}, ${projectId}, 'passed', 'manual' FROM generate_series(1, ${runCount})`;
  await client`INSERT INTO reports (id, entity_type, entity_id, report_path, status) SELECT uuidv7(), 'job', id::text, id::text || '/report', 'passed' FROM runs WHERE job_id = ${job.id}`;
  return job.id;
}

async function seedMonitor(orgId: string, projectId: string, resultCount: number) {
  const [monitor] = await mockDatabase.insert(schema.monitors).values({ organizationId: orgId, projectId, name: "M", type: "website", target: "https://example.test" }).returning();
  await client`INSERT INTO monitor_results (id, monitor_id, checked_at, location, status, is_up, is_status_change, consecutive_failure_count, consecutive_success_count, alerts_sent_for_failure, alerts_sent_for_recovery)
    SELECT uuidv7(), ${monitor.id}, now() - make_interval(secs => g), 'eu', 'up', true, false, 0, 0, 0, 0 FROM generate_series(1, ${resultCount}) g`;
  return monitor.id;
}

const count = async (table: string, where: string, value: string) => Number((await client.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where} = $1`, [value]))[0].n);
const orgRow = async (id: string) => (await client`SELECT * FROM organization WHERE id = ${id}`)[0];
const deletionRow = async (scope: string, targetId: string) => (await client`SELECT * FROM deletion_jobs WHERE scope = ${scope} AND target_id = ${targetId} ORDER BY created_at DESC LIMIT 1`)[0];
/** Drive a purge the way triggers would, skipping backoff waits. */
async function drive(scope: string, targetId: string, max = 400) {
  for (let i = 0; i < max; i++) {
    const row = await deletionRow(scope, targetId);
    if (row.state === "completed" || row.state === "failed") return row;
    await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${row.id}`;
    await runDeletion(row.id);
  }
  throw new Error("purge did not finish");
}
const makeDue = (orgId: string) => client`UPDATE organization SET deletion_purge_after = now() - interval '1 second' WHERE id = ${orgId}`;

describe("organization deletion", () => {
  it("request -> read-only window -> purge once due (happy path)", async () => {
    const seeded = await seedOrg({ projects: 2 });
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 5);
    const monitorId = await seedMonitor(seeded.orgId, seeded.projectIds[1], 20);
    const result = await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(result?.status).toBe("requested");
    const pending = await orgRow(seeded.orgId);
    expect(pending.deletion_requested_at).not.toBeNull();
    const windowDays = (new Date(pending.deletion_purge_after).getTime() - new Date(pending.deletion_requested_at).getTime()) / 86_400_000;
    expect(windowDays).toBeCloseTo(14, 1);
    expect(await isOrgPendingDeletion(seeded.orgId)).toBe(true);
    expect(mockUnscheduleJob).toHaveBeenCalledWith(jobId, expect.anything());
    expect(mockTrigger).not.toHaveBeenCalled(); // due at purge_after; the sweep triggers it then

    // Inside the window the purge refuses to delete anything, even when triggered.
    const row = await deletionRow("organization", seeded.orgId);
    expect(new Date(row.next_attempt_at).getTime()).toBeCloseTo(new Date(pending.deletion_purge_after).getTime(), -3);
    await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${row.id}`;
    await runDeletion(row.id);
    expect(await orgRow(seeded.orgId)).toBeDefined();
    expect(await count("runs", "job_id", jobId)).toBe(5);

    await makeDue(seeded.orgId);
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(await client`SELECT 1 FROM organization WHERE id = ${seeded.orgId}`).toHaveLength(0);
    expect(await count("projects", "organization_id", seeded.orgId)).toBe(0);
    expect(await count("runs", "job_id", jobId)).toBe(0);
    expect(await count("monitor_results", "monitor_id", monitorId)).toBe(0);
    expect(await count("member", "organization_id", seeded.orgId)).toBe(0);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "organization_purged" }));
  });

  it("two pods requesting at once produce one pending state and one purge row", async () => {
    const seeded = await seedOrg();
    const [a, b] = await Promise.all([
      requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } }),
      requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } }),
    ]);
    expect([a?.status, b?.status].sort()).toEqual(["already", "requested"]);
    expect(await count("deletion_jobs", "target_id", seeded.orgId)).toBe(1);
  });

  it("refuses a requester who is not an owner and never changes another organization", async () => {
    const mine = await seedOrg();
    const theirs = await seedOrg();
    await expect(requestOrganizationDeletion({ organizationId: theirs.orgId, actorUserId: mine.ownerId, guard: { ownerUserId: mine.ownerId } })).rejects.toThrow("members changed");
    expect((await orgRow(theirs.orgId)).deletion_requested_at).toBeNull();
    expect(await count("deletion_jobs", "target_id", theirs.orgId)).toBe(0);
  });

  it("cancel during the window: purge never runs, schedules come back, failed rows do not block a new request", async () => {
    const seeded = await seedOrg();
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 3);
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    const row = await deletionRow("organization", seeded.orgId);
    await client`UPDATE deletion_jobs SET state = 'failed' WHERE id = ${row.id}`;
    await cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId });
    expect((await orgRow(seeded.orgId)).deletion_requested_at).toBeNull();
    expect((await deletionRow("organization", seeded.orgId)).state).toBe("completed");
    await makeDue(seeded.orgId); // no longer pending: due-ness is irrelevant
    await runDeletion(row.id);
    expect(await count("runs", "job_id", jobId)).toBe(3);
    expect(await client`SELECT 1 FROM organization WHERE id = ${seeded.orgId}`).toHaveLength(1);
    // A second request after cancel works (the closed row no longer holds the unique slot).
    expect((await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } }))?.status).toBe("requested");
    expect(await count("deletion_jobs", "target_id", seeded.orgId)).toBe(2);
  });

  it("cancel is refused once the window is over or the purge has started", async () => {
    const seeded = await seedOrg();
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    await expect(cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId })).rejects.toMatchObject({ code: "PURGE_STARTED" });
    await client`UPDATE organization SET deletion_purge_after = now() + interval '1 day', deletion_meta = '{"purgeStartedAt":"2026-01-01"}' WHERE id = ${seeded.orgId}`;
    await expect(cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId })).rejects.toMatchObject({ code: "PURGE_STARTED" });
  });

  it("purge resumes after a crash mid-batch and finishes", async () => {
    const seeded = await seedOrg();
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 1100);
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    mockDeleteReports.mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error("storage down"));
    for (let i = 0; i < 40; i++) {
      const row = await deletionRow("organization", seeded.orgId);
      await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${row.id}`;
      await runDeletion(row.id);
      if ((await deletionRow("organization", seeded.orgId)).last_error) break;
    }
    const failed = await deletionRow("organization", seeded.orgId);
    expect(failed.state).toBe("queued");
    expect(failed.last_error).toContain("storage down");
    expect(await client`SELECT 1 FROM organization WHERE id = ${seeded.orgId}`).toHaveLength(1); // rows kept
    expect(Number(await count("runs", "job_id", jobId))).toBeGreaterThan(0);
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(await client`SELECT 1 FROM organization WHERE id = ${seeded.orgId}`).toHaveLength(0);
  });

  it("a storage failure that reports unsuccessful keeps the rows and retries", async () => {
    const seeded = await seedOrg();
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 10);
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    mockDeleteReports.mockResolvedValue({ success: false, failedObjects: [] });
    for (let i = 0; i < 12; i++) {
      const row = await deletionRow("organization", seeded.orgId);
      await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${row.id}`;
      await runDeletion(row.id);
      if ((await deletionRow("organization", seeded.orgId)).attempts > 0) break;
    }
    expect(await count("runs", "job_id", jobId)).toBe(10);
    mockDeleteReports.mockResolvedValue(ok);
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
  });

  it("purges a large tenant in bounded batches with a bounded statement count", async () => {
    const seeded = await seedOrg({ projects: 2 });
    await seedJob(seeded.orgId, seeded.projectId, 2500);
    await seedMonitor(seeded.orgId, seeded.projectIds[1], 3000);
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    queries.length = 0;
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(await count("runs", "project_id", seeded.projectId)).toBe(0);
    expect(queries.length).toBeLessThan(400); // ~5500 rows / 500 per batch, a handful of statements each, never one per row
    expect(mockDeleteReports.mock.calls.length).toBeLessThan(20);
  });

  it("super-admin early purge is audited with the reason and skips the window", async () => {
    const seeded = await seedOrg();
    const other = await seedOrg();
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 4);
    const [admin] = await mockDatabase.insert(schema.user).values({ name: "Admin", email: `${randomUUID()}@example.test`, role: "super_admin" }).returning();
    const outcome = await purgeOrganizationNow({ organizationId: seeded.orgId, adminUserId: admin.id, reason: "legal erasure request" });
    expect(outcome?.wasPending).toBe(false);
    expect(mockAdminAudit).toHaveBeenCalledWith(admin.id, "organization_purge_now", seeded.orgId, "organization", seeded.orgId, expect.objectContaining({ reason: "legal erasure request" }));
    expect(mockTrigger).toHaveBeenCalledWith(expect.any(String), 0, { replace: true });
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(await count("runs", "job_id", jobId)).toBe(0);
    expect(await client`SELECT 1 FROM organization WHERE id = ${other.orgId}`).toHaveLength(1); // tenancy
  });

  it("the sweep recreates a missing purge row for a pending organization", async () => {
    const seeded = await seedOrg();
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await client`DELETE FROM deletion_jobs WHERE target_id = ${seeded.orgId}`;
    expect(await enqueueOrphanedDeletions()).toBeGreaterThanOrEqual(1);
    expect(await count("deletion_jobs", "target_id", seeded.orgId)).toBe(1);
  });

  it("continues quiescing from the sweep and cancels queued runs", async () => {
    const seeded = await seedOrg();
    const jobId = await seedJob(seeded.orgId, seeded.projectId, 3);
    await client`UPDATE runs SET status = 'queued' WHERE job_id = ${jobId}`;
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(await client`SELECT 1 FROM runs WHERE job_id = ${jobId} AND error_details = 'Cancellation requested by user'`).toHaveLength(3);
    await client`UPDATE organization SET deletion_meta = '{}' WHERE id = ${seeded.orgId}`;
    expect(await continueQuiescing()).toBeGreaterThanOrEqual(1);
    expect((await orgRow(seeded.orgId)).deletion_meta.quiesced).toBe(true);
  });
});

describe("organization deletion billing (Polar mocked)", () => {
  const cloud = () => { process.env.SELF_HOSTED = "false"; process.env.POLAR_ACCESS_TOKEN = "test"; process.env.POLAR_WEBHOOK_SECRET = "test"; process.env.POLAR_SERVER = "sandbox"; };

  it("cancels at period end exactly once, even with two pods, and flushes final usage", async () => {
    cloud();
    mockPolarGet.mockResolvedValue({ cancel_at_period_end: false, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_1" });
    await Promise.all([
      requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } }),
      requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } }),
    ]);
    expect(mockPolarUpdate).toHaveBeenCalledTimes(1);
    expect(mockPolarUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(mockFlush).toHaveBeenCalledWith(seeded.orgId);
    await retryPendingBillingCancels(); // settled: nothing more
    expect(mockPolarUpdate).toHaveBeenCalledTimes(1);
    expect(mockPolarRevoke).not.toHaveBeenCalled();
  });

  it("is a no-op when the subscription already shows cancel-at-period-end, and cancelling the deletion does not reinstate it", async () => {
    cloud();
    mockPolarGet.mockResolvedValue({ cancel_at_period_end: true, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_2" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(mockPolarUpdate).not.toHaveBeenCalled();
    await cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId });
    expect(mockPolarUpdate).not.toHaveBeenCalled();
  });

  it("cancelling the deletion reinstates a cancellation this flow made", async () => {
    cloud();
    mockPolarGet.mockResolvedValueOnce({ cancel_at_period_end: false, status: "active" }).mockResolvedValue({ cancel_at_period_end: true, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_3" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    const outcome = await cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId });
    expect(outcome.billing).toBe("reinstated");
    expect(mockPolarUpdate).toHaveBeenLastCalledWith("sub_3", { cancel_at_period_end: false });
  });

  it("a provider outage while cancelling the deletion restores the organization anyway and reports it", async () => {
    cloud();
    mockPolarGet.mockResolvedValueOnce({ cancel_at_period_end: false, status: "active" }).mockRejectedValue(new Error("polar down"));
    const seeded = await seedOrg({ subscription: "sub_8" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    const outcome = await cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId });
    expect(outcome.billing).toBe("failed");
    expect((await orgRow(seeded.orgId)).deletion_requested_at).toBeNull();
  });

  it("a cancel that lands while the provider call is in flight gets its subscription reinstated, not silently ended", async () => {
    cloud();
    const seeded = await seedOrg({ subscription: "sub_10" });
    mockPolarGet.mockResolvedValueOnce({ cancel_at_period_end: false, status: "active" }).mockResolvedValue({ cancel_at_period_end: true, status: "active" });
    mockPolarUpdate.mockImplementationOnce(async () => {
      // The owner cancels after we read the state but before our result is written.
      await client`UPDATE organization SET deletion_requested_at = NULL, deletion_purge_after = NULL, deletion_meta = '{}' WHERE id = ${seeded.orgId}`;
    });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(mockPolarUpdate).toHaveBeenCalledTimes(2);
    expect(mockPolarUpdate).toHaveBeenLastCalledWith("sub_10", { cancel_at_period_end: false });
    expect((await orgRow(seeded.orgId)).deletion_meta).toEqual({});
  });

  it("a refused (too late) cancel never touches billing", async () => {
    cloud();
    mockPolarGet.mockResolvedValue({ cancel_at_period_end: false, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_9" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    mockPolarUpdate.mockClear();
    await makeDue(seeded.orgId);
    await expect(cancelOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId })).rejects.toMatchObject({ code: "PURGE_STARTED" });
    expect(mockPolarUpdate).not.toHaveBeenCalled();
  });

  it("a provider outage at request time leaves the cancellation for the sweep to retry", async () => {
    cloud();
    mockPolarGet.mockRejectedValueOnce(new Error("polar down")).mockResolvedValue({ cancel_at_period_end: false, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_4" });
    const result = await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(result?.billing).toBe("retry");
    expect(mockPolarUpdate).not.toHaveBeenCalled();
    expect(await retryPendingBillingCancels()).toBe(1);
    expect(mockPolarUpdate).toHaveBeenCalledTimes(1);
  });

  it("the purge revokes what is left, once, before deleting the organization", async () => {
    cloud();
    mockPolarGet.mockResolvedValue({ cancel_at_period_end: true, status: "active" });
    const seeded = await seedOrg({ subscription: "sub_5" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    const finished = await drive("organization", seeded.orgId);
    expect(finished.last_error).toBeNull();
    expect(finished.state).toBe("completed");
    expect(mockPolarRevoke).toHaveBeenCalledTimes(1);
    expect(mockPolarRevoke).toHaveBeenCalledWith("sub_5");
    expect(mockAdminAudit).toHaveBeenCalledWith(expect.anything(), "organization_teardown_started", seeded.orgId, "organization", seeded.orgId, expect.objectContaining({ subscriptionId: "sub_5" }));
  });

  it("a failed revoke keeps the organization and retries", async () => {
    cloud();
    mockPolarGet.mockResolvedValue({ cancel_at_period_end: true, status: "active" });
    mockPolarRevoke.mockRejectedValueOnce(new Error("boom"));
    const seeded = await seedOrg({ subscription: "sub_6" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(mockPolarRevoke).toHaveBeenCalledTimes(2);
  });

  it("self-hosted without Polar never touches billing", async () => {
    const seeded = await seedOrg({ subscription: "sub_7" });
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    await makeDue(seeded.orgId);
    expect((await drive("organization", seeded.orgId)).state).toBe("completed");
    expect(mockPolarGet).not.toHaveBeenCalled();
    expect(mockPolarRevoke).not.toHaveBeenCalled();
  });
});

describe("organization deletion emails (transport mocked)", () => {
  const sentKinds = () => mockSend.mock.calls.map((call) => (call[0] as { subject: string }).subject);

  it("sends request, 7 day and 1 day notices once each, and a completion notice", async () => {
    mockEmailConfigured = true;
    const seeded = await seedOrg();
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(sentKinds()).toEqual(["s-requested"]);
    await client`UPDATE organization SET deletion_requested_at = now() - interval '8 days', deletion_purge_after = now() + interval '6 days' WHERE id = ${seeded.orgId}`;
    await sendDueReminders(); await sendDueReminders();
    expect(sentKinds()).toEqual(["s-requested", "s-reminder"]);
    await client`UPDATE organization SET deletion_requested_at = now() - interval '13 days', deletion_purge_after = now() + interval '12 hours' WHERE id = ${seeded.orgId}`;
    await sendDueReminders(); await sendDueReminders();
    expect(sentKinds()).toHaveLength(3);
    await makeDue(seeded.orgId);
    await drive("organization", seeded.orgId);
    expect(sentKinds()).toEqual(["s-requested", "s-reminder", "s-reminder", "s-completed"]);
  });

  it("sends nothing without SMTP, and a failed send is retried by the next sweep", async () => {
    const seeded = await seedOrg();
    await requestOrganizationDeletion({ organizationId: seeded.orgId, actorUserId: seeded.ownerId, guard: { ownerUserId: seeded.ownerId } });
    expect(mockSend).not.toHaveBeenCalled();
    mockEmailConfigured = true;
    await client`UPDATE organization SET deletion_requested_at = now() - interval '8 days', deletion_purge_after = now() + interval '6 days' WHERE id = ${seeded.orgId}`;
    mockSend.mockResolvedValueOnce({ sentCount: 0, skippedAddresses: [] });
    await sendDueReminders();
    expect(await sendDueReminders()).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe("project deletion", () => {
  it("soft deletes, restores within the window, and purges after it", async () => {
    const seeded = await seedOrg({ projects: 2 });
    const projectId = seeded.projectIds[1];
    const monitorId = await seedMonitor(seeded.orgId, projectId, 5);
    const jobId = await seedJob(seeded.orgId, projectId, 4);
    const keepJob = await seedJob(seeded.orgId, seeded.projectId, 2);
    const deleted = await softDeleteProject({ projectId, actorUserId: seeded.ownerId });
    expect(deleted?.purgeAfter.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    const row = (await client`SELECT status, deleted_at, purge_after FROM projects WHERE id = ${projectId}`)[0];
    expect(row.status).toBe("deleted");
    expect((await client`SELECT status FROM monitors WHERE id = ${monitorId}`)[0].status).toBe("paused");
    expect(await isProjectDeleted(projectId, { fresh: true })).toBe(true);
    expect(mockTrigger).not.toHaveBeenCalled();

    await restoreProject({ projectId, actorUserId: seeded.ownerId });
    const restored = (await client`SELECT status, deleted_at, purge_after FROM projects WHERE id = ${projectId}`)[0];
    expect([restored.status, restored.deleted_at, restored.purge_after]).toEqual(["active", null, null]);
    expect((await client`SELECT status FROM monitors WHERE id = ${monitorId}`)[0].status).toBe("pending");
    expect((await deletionRow("project", projectId)).state).toBe("completed");

    await softDeleteProject({ projectId, actorUserId: seeded.ownerId });
    // Not due yet: the purge refuses.
    const pendingRow = await deletionRow("project", projectId);
    await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${pendingRow.id}`;
    await runDeletion(pendingRow.id);
    expect(await count("runs", "job_id", jobId)).toBe(4);
    await client`UPDATE projects SET purge_after = now() - interval '1 second' WHERE id = ${projectId}`;
    expect((await drive("project", projectId)).state).toBe("completed");
    expect(await client`SELECT 1 FROM projects WHERE id = ${projectId}`).toHaveLength(0);
    expect(await count("runs", "job_id", jobId)).toBe(0);
    expect(await count("monitor_results", "monitor_id", monitorId)).toBe(0);
    expect(await count("runs", "job_id", keepJob)).toBe(2); // siblings untouched
    expect(await client`SELECT 1 FROM organization WHERE id = ${seeded.orgId}`).toHaveLength(1);
  });

  it("restore after the window ends is refused", async () => {
    const seeded = await seedOrg({ projects: 2 });
    await softDeleteProject({ projectId: seeded.projectIds[1], actorUserId: seeded.ownerId });
    await client`UPDATE projects SET purge_after = now() - interval '1 second' WHERE id = ${seeded.projectIds[1]}`;
    await expect(restoreProject({ projectId: seeded.projectIds[1], actorUserId: seeded.ownerId })).rejects.toMatchObject({ code: "RESTORE_WINDOW_ENDED" });
  });

  it("two concurrent deletes leave one purge row; a deleted project does not delete twice", async () => {
    const seeded = await seedOrg({ projects: 2 });
    const [a, b] = await Promise.all([softDeleteProject({ projectId: seeded.projectIds[1], actorUserId: seeded.ownerId }), softDeleteProject({ projectId: seeded.projectIds[1], actorUserId: seeded.ownerId })]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await count("deletion_jobs", "target_id", seeded.projectIds[1])).toBe(1);
  });
});
