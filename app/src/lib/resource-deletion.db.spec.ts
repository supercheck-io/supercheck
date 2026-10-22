import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { NextRequest } from "next/server";
let mockDatabase: ReturnType<typeof drizzle>;
const mockDeleteReports = jest.fn();
const mockRemoveQueuedJob = jest.fn();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true, canCancelRunInProject: async () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({ getRunArtifactInputs: () => [], deleteReports: (...args: unknown[]) => mockDeleteReports(...args) }) }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: async () => true }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: async () => ({ userId: "user" }), isAuthError: () => false }));
jest.mock("@/lib/queue", () => ({ getQueues: async () => ({ playwrightQueues: { global: { getJob: async () => ({ id: "run", remove: () => mockRemoveQueuedJob() }) } }, k6Queues: {} }) }));
jest.mock("@/lib/cancellation-service", () => ({ setCancellationSignal: jest.fn() }));
jest.mock("@/lib/capacity-manager", () => ({ getCapacityManager: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: jest.fn() }));
import { deleteJobWithContext } from "@/lib/resource-deletion/job";
import { deleteMonitorWithContext } from "@/lib/resource-deletion/monitor";
import { logAuditEvent } from "@/lib/audit-logger";
import { POST as cancelRun } from "@/app/api/runs/[runId]/cancel/route";
import { deleteRunWithContext } from "@/lib/resource-deletion/run";

const databaseName = `deletion_alias_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  mockDatabase = drizzle(client, { schema });
  await client.unsafe(`
    CREATE TABLE jobs (id text PRIMARY KEY, project_id text, organization_id text, name text, description text, cron_schedule text, status text);
    CREATE TABLE job_tests (job_id text REFERENCES jobs(id));
    CREATE TABLE monitors (id text PRIMARY KEY, project_id text, organization_id text, name text, type text, target text);
    CREATE TABLE monitor_results (id text PRIMARY KEY, monitor_id text REFERENCES monitors(id), test_execution_id text, test_report_s3_url text);
    CREATE TABLE runs (id text PRIMARY KEY, project_id text, job_id text, status text, trigger text, started_at timestamptz, report_s3_url text, logs_s3_url text, metadata jsonb, completed_at timestamptz, error_details text);
    CREATE TABLE reports (id text PRIMARY KEY, entity_id text, entity_type text, report_path text, s3_url text);
    INSERT INTO runs (id, project_id, status) VALUES ('old-run', 'project', 'passed'), ('new-run', 'project', 'passed');
    INSERT INTO reports VALUES ('old', 'old-run', 'test', 'old-run/report', null), ('new', 'new-run', 'test', 'new-run/report', null), ('latest', 'test', 'test', 'new-run/report', null);
  `);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});
beforeEach(() => {
  mockDeleteReports.mockResolvedValue({ success: true });
  mockRemoveQueuedJob.mockRejectedValue(new Error("Job is locked"));
});
it("preserves another run's latest alias and removes the alias when its owner is deleted", async () => {
  const context = { userId: "user", organizationId: "org", project: { id: "project", name: "Project", organizationId: "org", isDefault: true, userRole: "org_owner" } };
  expect((await deleteRunWithContext("old-run", context)).success).toBe(true);
  expect(await client`SELECT id FROM reports ORDER BY id`).toEqual([{ id: "latest" }, { id: "new" }]);
  expect((await deleteRunWithContext("new-run", context)).success).toBe(true);
  expect(await client`SELECT id FROM reports`).toEqual([]);
});

it("retains an alias-only cleanup pointer after storage failure", async () => {
  await client`INSERT INTO runs (id, project_id, status) VALUES ('orphan-run', 'project', 'passed')`;
  await client`INSERT INTO reports VALUES ('alias-pointer', 'legacy-test', 'test', 'orphan-run/report', null)`;
  mockDeleteReports.mockResolvedValueOnce({ success: false });
  try {
    const context = { userId: "user", organizationId: "org", project: { id: "project", name: "Project", organizationId: "org", isDefault: true, userRole: "org_owner" } };
    expect((await deleteRunWithContext("orphan-run", context)).success).toBe(false);
    expect(await client`SELECT id FROM reports WHERE id='alias-pointer'`).toEqual([{ id: "alias-pointer" }]);
    expect(await client`SELECT id FROM runs WHERE id='orphan-run'`).toEqual([{ id: "orphan-run" }]);
  } finally {
    await client`DELETE FROM reports WHERE id='alias-pointer'`;
    await client`DELETE FROM runs WHERE id='orphan-run'`;
  }
});

it("does not hold the pooled database connection while storage deletion is pending", async () => {
  await client`INSERT INTO runs (id,project_id,status) VALUES ('slow-run','project','passed')`;
  await client`INSERT INTO reports VALUES ('slow-report','slow-run','test','slow-run/report',NULL)`;
  mockDeleteReports.mockImplementationOnce(async () => {
    // This client has max:1. A storage call inside a transaction would starve this query.
    await Promise.race([client`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error('storage cleanup holds database connection')), 1500).unref())]);
    return { success: true };
  });
  const context = { userId: "user", organizationId: "org", project: { id: "project", name: "Project", organizationId: "org", isDefault: true, userRole: "org_owner" as const } };
  expect((await deleteRunWithContext('slow-run', context)).success).toBe(true);
});

it("retains a run if its report receipt changes while storage is being deleted", async () => {
  await client`INSERT INTO runs (id,project_id,status) VALUES ('race-run','project','passed')`;
  await client`INSERT INTO reports VALUES ('race-report','race-run','test','race-run/report',NULL)`;
  mockDeleteReports.mockImplementationOnce(async () => {
    await client`UPDATE runs SET report_s3_url='http://storage/tests/race-run/report/index.html' WHERE id='race-run'`;
    return { success: true };
  });
  const context = { userId: "user", organizationId: "org", project: { id: "project", name: "Project", organizationId: "org", isDefault: true, userRole: "org_owner" as const } };
  const result = await deleteRunWithContext('race-run', context);
  expect(result.success).toBe(false);
  expect(result.error).toContain('changed during cleanup');
  expect(await client`SELECT id FROM runs WHERE id='race-run'`).toHaveLength(1);
});

const deletionContext = { userId: "user", organizationId: "org", project: { id: "project", name: "Project", organizationId: "org", isDefault: true, userRole: "org_owner" as const } };

async function seedJob(project = "project", org = "org") {
  const id = randomUUID();
  const runId = randomUUID();
  await client`INSERT INTO jobs (id,project_id,organization_id,name) VALUES (${id},${project},${org},'Job')`;
  await client`INSERT INTO job_tests VALUES (${id})`;
  await client`INSERT INTO runs (id,job_id,project_id,status) VALUES (${runId},${id},${project},'passed')`;
  await client`INSERT INTO reports VALUES (${`job-${id}`},${id},'job',${`${id}/report`},NULL), (${`run-${id}`},${runId},'job',${`${runId}/report`},NULL), (${`alias-${id}`},'saved-test','test',${`${runId}/report`},NULL)`;
  return { id, runId };
}
async function seedMonitor(project = "project", org = "org") {
  const id = randomUUID();
  const resultId = randomUUID();
  const executionId = `test-${randomUUID()}`;
  const url = `http://storage/monitors/${executionId}-a1b2c3d4/report/index.html`;
  await client`INSERT INTO monitors VALUES (${id},${project},${org},'Monitor','synthetic_test','https://example.test')`;
  await client`INSERT INTO monitor_results VALUES (${resultId},${id},${executionId},${url})`;
  await client`INSERT INTO reports VALUES (${`report-${id}`},${executionId},'monitor',${`${executionId}/report`},${url})`;
  return { id, resultId, executionId, url };
}
async function storageSuccessWithoutPinningConnection() {
  await Promise.race([client`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error('Storage pinned a transaction connection')), 1500).unref())]);
  return { success: true };
}

describe('job and monitor deletion against PostgreSQL', () => {
  beforeEach(() => mockDeleteReports.mockReset().mockResolvedValue({ success: true }));

  it('deletes job children and owned aliases while preserving another job', async () => {
    const own = await seedJob();
    const other = await seedJob();
    mockDeleteReports.mockImplementationOnce(storageSuccessWithoutPinningConnection);
    expect((await deleteJobWithContext(own.id, deletionContext)).success).toBe(true);
    expect(await client`SELECT id FROM jobs WHERE id=${own.id}`).toHaveLength(0);
    expect(await client`SELECT id FROM runs WHERE job_id=${own.id}`).toHaveLength(0);
    expect(await client`SELECT job_id FROM job_tests WHERE job_id=${own.id}`).toHaveLength(0);
    expect(await client`SELECT id FROM reports WHERE id IN (${`job-${own.id}`},${`run-${own.id}`},${`alias-${own.id}`})`).toHaveLength(0);
    expect(await client`SELECT id FROM jobs WHERE id=${other.id}`).toHaveLength(1);
    expect(await client`SELECT id FROM reports WHERE id=${`alias-${other.id}`}`).toHaveLength(1);
  });

  it('deletes monitor result and report metadata without touching another monitor', async () => {
    const own = await seedMonitor();
    const other = await seedMonitor();
    mockDeleteReports.mockImplementationOnce(storageSuccessWithoutPinningConnection);
    expect((await deleteMonitorWithContext(own.id, deletionContext)).success).toBe(true);
    expect(mockDeleteReports).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ entityType:'monitor', s3Url:own.url })]));
    expect(await client`SELECT id FROM monitors WHERE id=${own.id}`).toHaveLength(0);
    expect(await client`SELECT id FROM monitor_results WHERE monitor_id=${own.id}`).toHaveLength(0);
    expect(await client`SELECT id FROM reports WHERE entity_id=${own.executionId}`).toHaveLength(0);
    expect(await client`SELECT id FROM monitors WHERE id=${other.id}`).toHaveLength(1);
    expect(await client`SELECT id FROM reports WHERE entity_id=${other.executionId}`).toHaveLength(1);
  });

  it.each(['job','monitor'])('preserves all %s rows and pointers after partial S3 failure', async kind => {
    const own = kind === 'job' ? await seedJob() : await seedMonitor();
    mockDeleteReports.mockResolvedValueOnce({ success:false, deletedObjects:['partial'], failedObjects:[{key:'remaining',error:'unavailable'}] });
    const result = kind === 'job' ? await deleteJobWithContext(own.id,deletionContext) : await deleteMonitorWithContext(own.id,deletionContext);
    expect(result.success).toBe(false);
    if (kind === 'job') {
      expect(await client`SELECT id FROM jobs WHERE id=${own.id}`).toHaveLength(1);
      expect(await client`SELECT id FROM runs WHERE job_id=${own.id}`).toHaveLength(1);
      expect(await client`SELECT id FROM reports WHERE id=${`job-${own.id}`}`).toHaveLength(1);
    } else {
      expect(await client`SELECT id FROM monitors WHERE id=${own.id}`).toHaveLength(1);
      expect(await client`SELECT id FROM monitor_results WHERE monitor_id=${own.id}`).toHaveLength(1);
      expect(await client`SELECT id FROM reports WHERE id=${`report-${own.id}`}`).toHaveLength(1);
    }
  });

  it.each(['job','monitor'])('rejects %s deletion when a new child arrives during storage cleanup', async kind => {
    const own = kind === 'job' ? await seedJob() : await seedMonitor();
    mockDeleteReports.mockImplementationOnce(async () => {
      if (kind === 'job') await client`INSERT INTO runs (id,job_id,project_id,status) VALUES (${randomUUID()},${own.id},'project','running')`;
      else await client`INSERT INTO monitor_results VALUES (${randomUUID()},${own.id},'new-execution','http://storage/new')`;
      return {success:true};
    });
    const result = kind === 'job' ? await deleteJobWithContext(own.id,deletionContext) : await deleteMonitorWithContext(own.id,deletionContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('changed during cleanup');
    if (kind === 'job') expect(await client`SELECT id FROM runs WHERE job_id=${own.id}`).toHaveLength(2);
    else expect(await client`SELECT id FROM monitor_results WHERE monitor_id=${own.id}`).toHaveLength(2);
  });

  it.each([['job','foreign-project','org'],['job','project','foreign-org'],['monitor','foreign-project','org'],['monitor','project','foreign-org']])('denies %s in project %s / org %s before storage access', async (kind,project,org) => {
    const own = kind === 'job' ? await seedJob(project,org) : await seedMonitor(project,org);
    const result = kind === 'job' ? await deleteJobWithContext(own.id,deletionContext) : await deleteMonitorWithContext(own.id,deletionContext);
    expect(result.success).toBe(false);
    expect(mockDeleteReports).not.toHaveBeenCalled();
  });
});

it.each(['job','monitor'])('preserves %s pointers changed during storage cleanup', async kind => {
  const own = kind === 'job' ? await seedJob() : await seedMonitor();
  const reportId = kind === 'job' ? `job-${own.id}` : `report-${own.id}`;
  mockDeleteReports.mockImplementationOnce(async () => {
    await client`UPDATE reports SET report_path='new-execution/report', s3_url='http://storage/updated/index.html' WHERE id=${reportId}`;
    return {success:true};
  });
  const result = kind === 'job' ? await deleteJobWithContext(own.id,deletionContext) : await deleteMonitorWithContext(own.id,deletionContext);
  expect(result.success).toBe(false);
  expect(result.error).toContain('reports changed during cleanup');
  expect(await client`SELECT report_path FROM reports WHERE id=${reportId}`).toEqual([{report_path:'new-execution/report'}]);
  if (kind === 'job') expect(await client`SELECT id FROM jobs WHERE id=${own.id}`).toHaveLength(1);
  else expect(await client`SELECT id FROM monitors WHERE id=${own.id}`).toHaveLength(1);
});

it.each(['job','monitor'])('deletes an empty %s without contacting storage', async kind => {
  const id = randomUUID();
  if (kind === 'job') await client`INSERT INTO jobs (id,project_id,organization_id,name) VALUES (${id},'project','org','Empty')`;
  else await client`INSERT INTO monitors VALUES (${id},'project','org','Empty','http_request','https://example.test')`;
  mockDeleteReports.mockClear();
  const result = kind === 'job' ? await deleteJobWithContext(id,deletionContext) : await deleteMonitorWithContext(id,deletionContext);
  expect(result.success).toBe(true);
  expect(mockDeleteReports).not.toHaveBeenCalled();
});

it('cleans URL-only monitor metadata and preserves other report types', async () => {
  const own = await seedMonitor();
  const [row] = await client`SELECT test_report_s3_url FROM monitor_results WHERE id=${own.resultId}`;
  await client`UPDATE monitor_results SET test_execution_id=NULL WHERE id=${own.resultId}`;
  await client`INSERT INTO reports VALUES (${`other-type-${own.id}`},${own.executionId},'test','shared/report',${row.test_report_s3_url})`;
  mockDeleteReports.mockClear();
  expect((await deleteMonitorWithContext(own.id,deletionContext)).success).toBe(true);
  expect(mockDeleteReports).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({entityType:'monitor',s3Url:row.test_report_s3_url})]));
  expect(await client`SELECT id FROM reports WHERE id=${`report-${own.id}`}`).toHaveLength(0);
  expect(await client`SELECT id FROM reports WHERE id=${`other-type-${own.id}`}`).toHaveLength(1);
});

it('deletes every historical monitor result and metadata row in one guarded batch', async () => {
  const own = await seedMonitor();
  const second = randomUUID();
  await client`INSERT INTO monitor_results VALUES (${randomUUID()},${own.id},${second},${`http://storage/monitors/${second}/report/index.html`})`;
  await client`INSERT INTO reports VALUES (${`history-${own.id}`},${second},'monitor',${`${second}/report`},${`http://storage/monitors/${second}/report/index.html`})`;
  expect((await deleteMonitorWithContext(own.id,deletionContext)).success).toBe(true);
  expect(await client`SELECT id FROM monitor_results WHERE monitor_id=${own.id}`).toHaveLength(0);
  expect(await client`SELECT id FROM reports WHERE entity_id IN (${own.executionId},${second})`).toHaveLength(0);
});

it('rolls back report-pointer deletion after a database error, then permits retry', async () => {
  await client`CREATE TABLE deletion_guard (run_id text REFERENCES runs(id))`;
  const id = randomUUID();
  await client`INSERT INTO runs (id,project_id,status) VALUES (${id},'project','passed')`;
  await client`INSERT INTO reports VALUES (${`guard-${id}`},${id},'test',${`${id}/report`},NULL)`;
  await client`INSERT INTO deletion_guard VALUES (${id})`;
  expect((await deleteRunWithContext(id,deletionContext)).success).toBe(false);
  expect(await client`SELECT id FROM reports WHERE entity_id=${id}`).toHaveLength(1);
  expect(await client`SELECT id FROM runs WHERE id=${id}`).toHaveLength(1);
  await client`DELETE FROM deletion_guard WHERE run_id=${id}`;
  expect((await deleteRunWithContext(id,deletionContext)).success).toBe(true);
  expect(await client`SELECT id FROM reports WHERE entity_id=${id}`).toHaveLength(0);
});

it.each(['run','job','monitor'])('reports successful %s deletion even if audit logging fails afterward', async kind => {
  const own = kind === 'job' ? await seedJob() : kind === 'monitor' ? await seedMonitor() : {id:randomUUID()};
  if (kind === 'run') await client`INSERT INTO runs (id,project_id,status) VALUES (${own.id},'project','passed')`;
  jest.mocked(logAuditEvent).mockRejectedValueOnce(new Error('audit unavailable'));
  const result = kind === 'job' ? await deleteJobWithContext(own.id,deletionContext) : kind === 'monitor' ? await deleteMonitorWithContext(own.id,deletionContext) : await deleteRunWithContext(own.id,deletionContext);
  expect(result.success).toBe(true);
});

it("ignores an execution ID without an uploaded monitor report", async () => {
  const own = await seedMonitor();
  await client`DELETE FROM reports WHERE id=${`report-${own.id}`}`;
  await client`UPDATE monitor_results SET test_report_s3_url=NULL WHERE id=${own.resultId}`;
  mockDeleteReports.mockClear();
  expect((await deleteMonitorWithContext(own.id, deletionContext)).success).toBe(true);
  expect(mockDeleteReports).not.toHaveBeenCalled();
});

it("waits for a cancelled upload to drain and retains its final pointers on deletion failure", async () => {
  const own = await seedJob();
  await client`UPDATE runs SET status='running' WHERE id=${own.runId}`;
  let finishUpload!: () => void;
  const uploadBlocked = new Promise<void>(resolve => { finishUpload = resolve; });
  const worker = (async () => {
    await uploadBlocked;
    await client`INSERT INTO reports VALUES (${`final-${own.id}`},${own.runId},'job',${`${own.runId}/report`},NULL)`;
    await client`UPDATE runs SET status='error', completed_at=now() WHERE id=${own.runId}`;
  })();
  try {
    const response = await cancelRun(new NextRequest(`http://localhost/api/runs/${own.runId}/cancel`, { method: "POST" }), { params: Promise.resolve({ runId: own.runId }) });
    expect(response.status).toBe(200);
    expect(await client`SELECT status, completed_at FROM runs WHERE id=${own.runId}`).toEqual([{status:'running',completed_at:null}]);
    mockDeleteReports.mockClear();
    expect((await deleteRunWithContext(own.runId, deletionContext)).success).toBe(false);
    expect(mockDeleteReports).not.toHaveBeenCalled();
    finishUpload();
    await worker;
    mockDeleteReports.mockResolvedValueOnce({success:false});
    expect((await deleteRunWithContext(own.runId, deletionContext)).success).toBe(false);
    expect(await client`SELECT id FROM reports WHERE id=${`final-${own.id}`}`).toHaveLength(1);
    expect(await client`SELECT id FROM runs WHERE id=${own.runId}`).toHaveLength(1);
    expect((await deleteRunWithContext(own.runId, deletionContext)).success).toBe(true);
    expect(await client`SELECT id FROM reports WHERE id=${`final-${own.id}`}`).toHaveLength(0);
  } finally {
    finishUpload();
    await worker;
  }
});

it.each([false, true])("preserves a running callback after queue removal (admission race=%s)", async claimWins => {
  const own = await seedJob();
  await client`UPDATE runs SET status=${claimWins ? 'queued' : 'running'} WHERE id=${own.runId}`;
  mockRemoveQueuedJob.mockImplementationOnce(async () => {
    if (claimWins) await client`UPDATE runs SET status='running' WHERE id=${own.runId} AND status='queued'`;
  });
  const response = await cancelRun(new NextRequest(`http://localhost/api/runs/${own.runId}/cancel`, { method: "POST" }), { params: Promise.resolve({ runId: own.runId }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ queueRemoved:true, message:"Cancellation requested; waiting for execution to stop" });
  expect(await client`SELECT status, completed_at FROM runs WHERE id=${own.runId}`).toEqual([{status:'running',completed_at:null}]);
  expect((await deleteRunWithContext(own.runId, deletionContext)).success).toBe(false);
});
