/** @jest-environment node */
// Needs TEST_DATABASE_URL (npm run test:db). Real migrations, real Postgres; storage, schedulers and Redis are mocked.
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
const mockUnscheduleJob = jest.fn();
const mockUnscheduleMonitor = jest.fn();
const mockSignal = jest.fn();
const mockTrigger = jest.fn();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({ getRunArtifactInputs: () => [], deleteReports: (...a: unknown[]) => mockDeleteReports(...a) }) }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: (...a: unknown[]) => mockUnscheduleJob(...a) }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: (...a: unknown[]) => mockUnscheduleMonitor(...a), removeScheduledMonitor: (...a: unknown[]) => mockUnscheduleMonitor(...a) }));
jest.mock("@/lib/cancellation-service", () => ({ RUN_CANCELLATION_MARKER: "Cancellation requested by user", setCancellationSignal: (...a: unknown[]) => mockSignal(...a) }));
jest.mock("./queue", () => ({ triggerDeletion: (...a: unknown[]) => mockTrigger(...a) }));
process.env.DELETION_BATCH_PAUSE_MS = "0";
import { requestJobDeletion, requestMonitorDeletion } from "./request";
import { runDeletion } from "./runner";
import { claimDeletion, completeDeletion, enqueueOrphanedDeletions, failDeletion, findDueDeletions, heartbeat, LostClaimError, pruneCompletedDeletions, retryFailedDeletion, MAX_ATTEMPTS } from "./jobs";

const name = `deletion_purge_${randomUUID().replaceAll("-", "")}`;
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
  client = postgres(target.toString(), { max: 8, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema, logger: { logQuery: (q) => { queries.push(q); } } });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

beforeEach(async () => {
  // Earlier tests leave claimed rows behind; the global concurrency cap would otherwise block this one.
  await client`UPDATE deletion_jobs SET state = 'completed' WHERE state <> 'completed'`;
  mockDeleteReports.mockReset().mockResolvedValue({ success: true });
  mockUnscheduleJob.mockReset().mockResolvedValue(true);
  mockUnscheduleMonitor.mockReset().mockResolvedValue(true);
  mockSignal.mockReset().mockResolvedValue(undefined);
  mockTrigger.mockReset().mockResolvedValue(undefined);
  queries.length = 0;
});

async function seedOrg() {
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  return { orgId: organization.id, projectId: project.id };
}

async function seedJob(runCount: number, extra: { orgId?: string; projectId?: string } = {}) {
  const base = extra.orgId && extra.projectId ? { orgId: extra.orgId, projectId: extra.projectId } : await seedOrg();
  const [job] = await mockDatabase.insert(schema.jobs).values({ organizationId: base.orgId, projectId: base.projectId, name: "Job" }).returning();
  await client`INSERT INTO runs (id, job_id, project_id, status, trigger)
    SELECT uuidv7(), ${job.id}, ${base.projectId}, 'passed', 'manual' FROM generate_series(1, ${runCount})`;
  await client`INSERT INTO reports (id, entity_type, entity_id, report_path, status)
    SELECT uuidv7(), 'job', id::text, id::text || '/report', 'passed' FROM runs WHERE job_id = ${job.id}`;
  return { ...base, jobId: job.id };
}

async function seedMonitor(resultCount: number, extra: { orgId?: string; projectId?: string } = {}) {
  const base = extra.orgId && extra.projectId ? { orgId: extra.orgId, projectId: extra.projectId } : await seedOrg();
  const [monitor] = await mockDatabase.insert(schema.monitors).values({ organizationId: base.orgId, projectId: base.projectId, name: "M", type: "website", target: "https://example.test" }).returning();
  await client`INSERT INTO monitor_results (id, monitor_id, checked_at, location, status, is_up, is_status_change, consecutive_failure_count, consecutive_success_count, alerts_sent_for_failure, alerts_sent_for_recovery, test_execution_id)
    SELECT uuidv7(), ${monitor.id}, now() - make_interval(secs => g), 'eu', 'up', true, false, 0, 0, 0, 0, CASE WHEN g % 100 = 0 THEN 'exec-' || g || '-' || ${monitor.id} END FROM generate_series(1, ${resultCount}) g`;
  await client`INSERT INTO reports (id, entity_type, entity_id, report_path, status)
    SELECT uuidv7(), 'monitor', test_execution_id, test_execution_id || '/report', 'passed' FROM monitor_results WHERE monitor_id = ${monitor.id} AND test_execution_id IS NOT NULL`;
  return { ...base, monitorId: monitor.id };
}

const scope = (s: { jobId?: string; monitorId?: string; orgId: string; projectId: string }) => ({ id: (s.jobId ?? s.monitorId)!, projectId: s.projectId, organizationId: s.orgId, userId: randomUUID() });
const count = async (table: string, where: string, value: string) => Number((await client.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where} = $1`, [value]))[0].n);
const deletionRow = async (targetId: string) => (await mockDatabase.select().from(schema.deletionJobs).where(eq(schema.deletionJobs.targetId, targetId)))[0];
/** Drive a purge to its end the way triggers would, skipping backoff waits. */
async function drive(targetId: string, max = 50) {
  for (let i = 0; i < max; i++) {
    const row = await deletionRow(targetId);
    if (row.state === "completed" || row.state === "failed") return row;
    await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${row.id}`;
    await runDeletion(row.id);
  }
  throw new Error("purge did not finish");
}

describe("job deletion", () => {
  it("flags, cancels active runs and queues one purge; a second request converges on it", async () => {
    const seeded = await seedJob(3);
    await client`UPDATE runs SET status = 'queued' WHERE id = (SELECT id FROM runs WHERE job_id = ${seeded.jobId} LIMIT 1)`;
    const [first, second] = await Promise.all([requestJobDeletion(scope(seeded)), requestJobDeletion(scope(seeded))]);
    expect([first.status, second.status].sort()).toEqual(["already", "requested"]);
    expect((await client`SELECT deleting_at FROM jobs WHERE id = ${seeded.jobId}`)[0].deleting_at).not.toBeNull();
    expect(await count("deletion_jobs", "target_id", seeded.jobId)).toBe(1);
    expect(await client`SELECT id FROM runs WHERE job_id = ${seeded.jobId} AND error_details = 'Cancellation requested by user'`).toHaveLength(1);
    expect(mockSignal).toHaveBeenCalledTimes(1);
    expect(mockTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not touch another tenant's job (tenancy)", async () => {
    const mine = await seedJob(1);
    const theirs = await seedJob(1);
    expect((await requestJobDeletion({ ...scope(mine), id: theirs.jobId })).status).toBe("not_found");
    expect((await client`SELECT deleting_at FROM jobs WHERE id = ${theirs.jobId}`)[0].deleting_at).toBeNull();
    expect(await count("deletion_jobs", "target_id", theirs.jobId)).toBe(0);
  });

  it("never refuses for active runs and purges a large job in bounded batches", async () => {
    const seeded = await seedJob(1300);
    const runIds = (await client`SELECT id::text FROM runs WHERE job_id = ${seeded.jobId}`).map((r) => r.id as string);
    await client`UPDATE runs SET status = 'running' WHERE id = (SELECT id FROM runs WHERE job_id = ${seeded.jobId} LIMIT 1)`;
    expect((await requestJobDeletion(scope(seeded))).status).toBe("requested");
    await client`UPDATE runs SET status = 'passed' WHERE job_id = ${seeded.jobId}`; // the cancelled run ended
    queries.length = 0;
    const done = await drive(seeded.jobId);
    expect(done.state).toBe("completed");
    expect(await count("jobs", "id", seeded.jobId)).toBe(0);
    expect(await count("runs", "job_id", seeded.jobId)).toBe(0);
    expect(await client`SELECT 1 FROM reports WHERE entity_id = ANY(${runIds})`).toHaveLength(0);
    // 1300 runs / 500 per batch = 3 storage calls; statements stay far below one per row.
    expect(mockDeleteReports).toHaveBeenCalledTimes(3);
    expect(queries.length).toBeLessThan(80);
  });

  it("keeps rows when storage fails, then resumes after the crash and finishes", async () => {
    const seeded = await seedJob(1100);
    await requestJobDeletion(scope(seeded));
    mockDeleteReports.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, failedObjects: [] });
    const outcome = await runDeletion((await deletionRow(seeded.jobId)).id);
    expect(outcome.retryInMs).toBeGreaterThan(0);
    const after = await deletionRow(seeded.jobId);
    expect(after.state).toBe("queued");
    expect(after.attempts).toBe(1);
    expect(after.lastError).toContain("storage");
    expect(await count("runs", "job_id", seeded.jobId)).toBe(600); // the first batch is gone; the failed batch kept its rows
    expect((await drive(seeded.jobId)).state).toBe("completed");
    expect(await count("runs", "job_id", seeded.jobId)).toBe(0);
  });

  it("a scheduler failure retries instead of dropping the purge", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    mockUnscheduleJob.mockRejectedValueOnce(new Error("redis down"));
    await runDeletion((await deletionRow(seeded.jobId)).id);
    expect((await deletionRow(seeded.jobId)).lastError).toContain("redis down");
    expect((await drive(seeded.jobId)).state).toBe("completed");
  });

  it("purges a run that a late schedule created after the flag", async () => {
    const seeded = await seedJob(2);
    await requestJobDeletion(scope(seeded));
    mockDeleteReports.mockImplementationOnce(async () => {
      await client`INSERT INTO runs (id, job_id, project_id, status, trigger) VALUES (uuidv7(), ${seeded.jobId}, ${seeded.projectId}, 'passed', 'schedule')`;
      return { success: true };
    });
    expect((await drive(seeded.jobId)).state).toBe("completed");
    expect(await count("runs", "job_id", seeded.jobId)).toBe(0);
    expect(await count("jobs", "id", seeded.jobId)).toBe(0);
  });
});

describe("monitor deletion", () => {
  it("flags once, unschedules, and purges results and report rows without touching another monitor", async () => {
    const mine = await seedMonitor(2500);
    const other = await seedMonitor(10);
    expect((await requestMonitorDeletion(scope(mine))).status).toBe("requested");
    expect((await requestMonitorDeletion(scope(mine))).status).toBe("already");
    expect(await count("deletion_jobs", "target_id", mine.monitorId)).toBe(1);
    queries.length = 0;
    expect((await drive(mine.monitorId)).state).toBe("completed");
    expect(await count("monitors", "id", mine.monitorId)).toBe(0);
    expect(await count("monitor_results", "monitor_id", mine.monitorId)).toBe(0);
    expect(await count("monitor_results", "monitor_id", other.monitorId)).toBe(10);
    expect(await client`SELECT 1 FROM reports WHERE entity_id LIKE ${"%" + mine.monitorId}`).toHaveLength(0);
    expect(await client`SELECT 1 FROM reports WHERE entity_id LIKE ${"%" + other.monitorId}`).toHaveLength(0); // other has 10 results: none sampled for a report
    expect(queries.length).toBeLessThan(80);
    expect(mockUnscheduleMonitor).toHaveBeenCalled();
  });

  it("purges a result written by an in-flight check after the flag", async () => {
    const seeded = await seedMonitor(5);
    await requestMonitorDeletion(scope(seeded));
    let injected = false;
    const real = mockDatabase.transaction.bind(mockDatabase);
    jest.spyOn(mockDatabase, "transaction").mockImplementation(((fn: never, cfg: never) => {
      if (!injected) {
        injected = true;
        return client`INSERT INTO monitor_results (id, monitor_id, checked_at, location, status, is_up, is_status_change, consecutive_failure_count, consecutive_success_count, alerts_sent_for_failure, alerts_sent_for_recovery)
          VALUES (uuidv7(), ${seeded.monitorId}, now(), 'eu', 'up', true, false, 0, 0, 0, 0)`.then(() => real(fn, cfg));
      }
      return real(fn, cfg);
    }) as never);
    try {
      expect((await drive(seeded.monitorId)).state).toBe("completed");
    } finally {
      jest.restoreAllMocks();
    }
    expect(await count("monitors", "id", seeded.monitorId)).toBe(0);
  });

  it("does not delete monitors of another project in the same organization", async () => {
    const a = await seedMonitor(1);
    const [otherProject] = await mockDatabase.insert(schema.projects).values({ organizationId: a.orgId, name: "Other" }).returning();
    expect((await requestMonitorDeletion({ ...scope(a), projectId: otherProject.id })).status).toBe("not_found");
    expect(await count("monitors", "id", a.monitorId)).toBe(1);
  });
});

describe("claims, retries and the sweep", () => {
  it("admits one runner when two pods claim the same purge", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    const id = (await deletionRow(seeded.jobId)).id;
    const results = await Promise.all([claimDeletion(id), claimDeletion(id), claimDeletion(id)]);
    expect(results.filter((r) => "claimed" in r)).toHaveLength(1);
  });

  it("runs one purge per organization", async () => {
    const seeded = await seedJob(1);
    const second = await seedJob(1, seeded);
    await requestJobDeletion(scope(seeded));
    await requestJobDeletion(scope(second));
    const [a, b] = [(await deletionRow(seeded.jobId)).id, (await deletionRow(second.jobId)).id];
    expect("claimed" in (await claimDeletion(a))).toBe(true);
    expect(await claimDeletion(b)).toEqual({ blocked: true });
    // The blocked row is pushed out: duplicate triggers stop at "busy" and the sweep does not re-select it.
    expect(await claimDeletion(b)).toMatchObject({ skip: "busy" });
    expect(await findDueDeletions()).not.toContain(b);
  });

  it("takes over a purge whose pod crashed (stale heartbeat) and finds it in the sweep", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    const row = await deletionRow(seeded.jobId);
    await client`UPDATE deletion_jobs SET state = 'running', heartbeat_at = now() - interval '10 minutes' WHERE id = ${row.id}`;
    expect(await findDueDeletions()).toContain(row.id);
    expect("claimed" in (await claimDeletion(row.id))).toBe(true);
  });

  it("fences a runner that lost its claim: it can neither heartbeat nor finish over the new owner", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    const id = (await deletionRow(seeded.jobId)).id;
    const first = await claimDeletion(id);
    if (!("claimed" in first)) throw new Error("expected a claim");
    await client`UPDATE deletion_jobs SET heartbeat_at = now() - interval '10 minutes' WHERE id = ${id}`;
    const second = await claimDeletion(id);
    if (!("claimed" in second)) throw new Error("expected a takeover");
    await expect(heartbeat(first.claimed)).rejects.toBeInstanceOf(LostClaimError);
    await completeDeletion(first.claimed); // no-op: not the owner
    expect((await deletionRow(seeded.jobId)).state).toBe("running");
    await expect(heartbeat(second.claimed, { progressed: true })).resolves.toBeUndefined();
  });

  it("resets the attempt budget when a step makes progress, so a long purge is not failed by scattered errors", async () => {
    const seeded = await seedMonitor(1200);
    await requestMonitorDeletion(scope(seeded));
    // Fail the storage call of the second batch only: attempts goes to 1, then progress brings it back to 0.
    mockDeleteReports.mockResolvedValue({ success: true });
    await client`UPDATE deletion_jobs SET attempts = ${MAX_ATTEMPTS - 1} WHERE target_id = ${seeded.monitorId}`;
    const done = await drive(seeded.monitorId);
    expect(done.state).toBe("completed");
    expect(done.attempts).toBe(0);
  });

  it("restarts the attempt count after progress even when the claim started at the limit", async () => {
    const seeded = await seedJob(1100);
    await requestJobDeletion(scope(seeded));
    await client`UPDATE deletion_jobs SET attempts = ${MAX_ATTEMPTS - 1} WHERE target_id = ${seeded.jobId}`;
    mockDeleteReports.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, failedObjects: [] });
    await runDeletion((await deletionRow(seeded.jobId)).id);
    const row = await deletionRow(seeded.jobId);
    expect(row.state).toBe("queued"); // not failed: a batch succeeded, so this is attempt 1 again
    expect(row.attempts).toBe(1);
  });

  it("returns a retry delay for a purge that is not due yet instead of dropping the trigger", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    const id = (await deletionRow(seeded.jobId)).id;
    await client`UPDATE deletion_jobs SET next_attempt_at = now() + interval '45 seconds' WHERE id = ${id}`;
    const result = await claimDeletion(id);
    expect("skip" in result && result.skip === "busy" && (result.retryInMs ?? 0) > 30_000).toBe(true);
  });

  it("prunes old completed rows only", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    await drive(seeded.jobId);
    await client`UPDATE deletion_jobs SET completed_at = now() - interval '40 days' WHERE target_id = ${seeded.jobId}`;
    const fresh = await seedJob(1);
    await requestJobDeletion(scope(fresh));
    await drive(fresh.jobId);
    expect(await pruneCompletedDeletions()).toBeGreaterThanOrEqual(1);
    expect(await count("deletion_jobs", "target_id", seeded.jobId)).toBe(0);
    expect(await count("deletion_jobs", "target_id", fresh.jobId)).toBe(1);
  });

  it("gives up after the attempt budget and a super admin can retry it", async () => {
    const seeded = await seedJob(1);
    await requestJobDeletion(scope(seeded));
    const id = (await deletionRow(seeded.jobId)).id;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await client`UPDATE deletion_jobs SET next_attempt_at = now() WHERE id = ${id}`;
      const claim = await claimDeletion(id);
      if (!("claimed" in claim)) throw new Error("expected a claim");
      await failDeletion(claim.claimed, new Error("boom"));
    }
    const row = await deletionRow(seeded.jobId);
    expect(row.state).toBe("failed");
    expect(await retryFailedDeletion(row.id)).toBe(true);
    expect(await retryFailedDeletion(row.id)).toBe(false);
    expect((await drive(seeded.jobId)).state).toBe("completed");
  });

  it("creates the purge row for a flagged target that never got one", async () => {
    const seeded = await seedJob(1);
    await client`UPDATE jobs SET deleting_at = now() WHERE id = ${seeded.jobId}`;
    expect(await enqueueOrphanedDeletions()).toBeGreaterThanOrEqual(1);
    expect(await count("deletion_jobs", "target_id", seeded.jobId)).toBe(1);
    expect(await enqueueOrphanedDeletions()).toBe(0);
  });
});
