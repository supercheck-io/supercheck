import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { NextRequest } from "next/server";
let mockDatabase: ReturnType<typeof drizzle>;
const queries: string[] = [];
const mockDeleteReports = jest.fn();
const mockRemoveQueuedJob = jest.fn();
let mockJobProcessedOn: number | undefined = Date.now();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true, canCancelRunInProject: async () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({ getRunArtifactInputs: () => [], deleteReports: (...args: unknown[]) => mockDeleteReports(...args) }) }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: async () => true }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: async () => ({ userId: "user" }), isAuthError: () => false }));
jest.mock("@/lib/queue", () => ({ getCapacityQueues: async () => ({ playwrightQueues: { global: { getJob: async () => ({ id: "run", processedOn: mockJobProcessedOn, getState: async () => "waiting", remove: () => mockRemoveQueuedJob() }) } }, k6Queues: {} }) }));
jest.mock("@/lib/cancellation-service", () => ({ RUN_CANCELLATION_MARKER: "Cancellation requested by user", setCancellationSignal: jest.fn() }));
jest.mock("@/lib/capacity-manager", () => ({ getCapacityManager: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: jest.fn() }));
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
  mockDatabase = drizzle(client, { schema, logger: { logQuery: (query) => { queries.push(query); } } });
  await client.unsafe(`
    CREATE TABLE jobs (id text PRIMARY KEY, project_id text, organization_id text, name text, description text, cron_schedule text, status text, deleting_at timestamptz);
    CREATE TABLE job_tests (job_id text REFERENCES jobs(id));
    CREATE TABLE monitors (id text PRIMARY KEY, project_id text, organization_id text, name text, type text, target text, deleting_at timestamptz);
    CREATE TABLE monitor_results (id text PRIMARY KEY, monitor_id text REFERENCES monitors(id), test_execution_id text, test_report_s3_url text);
    CREATE TABLE runs (id text PRIMARY KEY, project_id text, job_id text, status text, trigger text, started_at timestamptz, report_s3_url text, logs_s3_url text, metadata jsonb, completed_at timestamptz, error_details text, created_at timestamptz DEFAULT now());
    CREATE TABLE reports (id text PRIMARY KEY, entity_id text, entity_type text, report_path text, s3_url text);
    CREATE TABLE k6_performance_runs (id text PRIMARY KEY, run_id text, job_id text);
    CREATE TABLE sre_service_resources (id text PRIMARY KEY, resource_type text, resource_id text);
    CREATE TABLE trial_suspensions (id text PRIMARY KEY, resource_type text, resource_id text);
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

const cancelOwnRun = (runId: string) =>
  cancelRun(new NextRequest(`http://localhost/api/runs/${runId}/cancel`, { method: "POST" }), { params: Promise.resolve({ runId }) });

describe("cancelling a run whose job a worker already handed back", () => {
  beforeEach(() => { mockJobProcessedOn = Date.now(); });
  afterAll(() => { mockJobProcessedOn = undefined; });

  it.each(["queued", "running"])("leaves the %s run and its job for the worker, with the marker persisted", async status => {
    const own = await seedJob();
    await client`UPDATE runs SET status=${status} WHERE id=${own.runId}`;
    mockRemoveQueuedJob.mockClear();
    const response = await cancelOwnRun(own.runId);
    expect(response.status).toBe(200);
    expect(mockRemoveQueuedJob).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ queueRemoved: false, message: "Cancellation requested; waiting for execution to stop" });
    expect(await client`SELECT status, completed_at, error_details FROM runs WHERE id=${own.runId}`).toEqual([{ status, completed_at: null, error_details: "Cancellation requested by user" }]);
    expect((await deleteRunWithContext(own.runId, deletionContext)).success).toBe(false);
  });
});

describe("cancelling a run whose waiting job was never picked up", () => {
  beforeEach(() => { mockJobProcessedOn = undefined; mockRemoveQueuedJob.mockReset().mockResolvedValue(undefined); });

  it.each(["queued", "running"])("ends the %s run right away", async status => {
    const own = await seedJob();
    await client`UPDATE runs SET status=${status} WHERE id=${own.runId}`;
    const response = await cancelOwnRun(own.runId);
    expect(await response.json()).toMatchObject({ queueRemoved: true, message: "Run cancelled successfully" });
    expect(await client`SELECT status, completed_at IS NOT NULL AS done FROM runs WHERE id=${own.runId}`).toEqual([{ status: "error", done: true }]);
  });

  it("never overwrites a run that finished before the cancel committed", async () => {
    const own = await seedJob();
    await client`UPDATE runs SET status='passed', completed_at=now() WHERE id=${own.runId}`;
    const response = await cancelOwnRun(own.runId);
    expect(response.status).toBe(400);
    expect(await client`SELECT status FROM runs WHERE id=${own.runId}`).toEqual([{ status: "passed" }]);
  });

  it("answers a repeated cancel without changing anything", async () => {
    const own = await seedJob();
    await client`UPDATE runs SET status='running' WHERE id=${own.runId}`;
    await cancelOwnRun(own.runId);
    const again = await cancelOwnRun(own.runId);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ message: "Run cancelled successfully", queueRemoved: false });
  });
});
