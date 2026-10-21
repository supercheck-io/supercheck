import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
let mockDatabase: ReturnType<typeof drizzle>;
const mockContext = { userId: "user", organizationId: "org", project: { id: "project" } };
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: async () => mockContext, isAuthError: () => false }));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: () => true,
  requireAuth: async () => ({ userId: "user" }),
  getUserRole: async () => "project_viewer",
  hasPermissionForUser: async () => true,
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { NextRequest } from "next/server";
import { GET } from "@/app/api/runs/route";
import { GET as detail } from "@/app/api/runs/[runId]/route";
import { getRun } from "@/actions/get-runs";
import { runSchema } from "@/components/runs/schema";

const databaseName = `standalone_runs_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${databaseName}`;
  client = postgres(target.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  await client.unsafe(`
    CREATE TABLE projects (id text PRIMARY KEY, organization_id text, name text);
    CREATE TABLE jobs (id text PRIMARY KEY, project_id text, organization_id text, name text, job_type text);
    CREATE TABLE tests (id text PRIMARY KEY, project_id text, title text);
    CREATE TABLE runs (id text PRIMARY KEY, job_id text, project_id text, status text, duration_ms integer,
      started_at timestamptz, completed_at timestamptz, trigger text NOT NULL DEFAULT 'manual', location text, logs text,
      error_details text, report_s3_url text, metadata jsonb);
    CREATE TABLE reports (entity_id text, entity_type text, s3_url text);
    CREATE TABLE job_tests (job_id text, test_id text);
    INSERT INTO projects VALUES ('project', 'org', 'Project'), ('foreign', 'other', 'Foreign');
    INSERT INTO jobs VALUES ('job', 'project', 'org', 'Scheduled job', 'playwright');
    INSERT INTO tests VALUES ('test', 'project', 'Standalone browser'), ('load', 'project', 'Standalone load');
    INSERT INTO runs (id, job_id, project_id, status, started_at, metadata) VALUES
      ('job-run', 'job', 'project', 'passed', '2026-01-01', '{}'),
      ('browser-run', null, 'project', 'passed', '2026-01-02', '{"testId":"test","testType":"browser"}'),
      ('load-run', null, 'project', 'failed', '2026-01-03', '{"testId":"load","testType":"performance"}'),
      ('foreign-run', null, 'foreign', 'passed', '2026-01-04', '{"testId":"test"}');
    INSERT INTO reports VALUES ('browser-run', 'test', 'browser-report'), ('load-run', 'k6_test', 'load-report');
  `);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("lists standalone and job runs together with names, types and reports", async () => {
  const response = await GET(new NextRequest("http://localhost/api/runs?limit=2"));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.pagination.total).toBe(3);
  expect(data.data.map((run: { id: string }) => run.id)).toEqual(["load-run", "browser-run"]);
  expect(data.data[0]).toMatchObject({ jobId: null, jobName: "Standalone load", jobType: "k6", reportUrl: "load-report" });
  expect(data.data[1]).toMatchObject({ jobId: null, jobName: "Standalone browser", jobType: "playwright", reportUrl: "browser-report" });
});
it("preserves job and status filters without exposing another project", async () => {
  const result = await GET(new NextRequest("http://localhost/api/runs?jobId=job&status=passed"));
  const data = await result.json();
  expect(data.data.map((run: { id: string }) => run.id)).toEqual(["job-run"]);
  expect(data.pagination.total).toBe(1);
});
it("shows standalone details consistently through API and server action", async () => {
  const response = await detail(new Request("http://localhost"), { params: Promise.resolve({ runId: "load-run" }) });
  expect(await response.json()).toMatchObject({ jobId: null, jobName: "Standalone load", jobType: "k6", reportUrl: "load-report", testCount: 1 });
  expect(await getRun("load-run")).toMatchObject({ jobName: "Standalone load", jobType: "k6", reportUrl: "load-report", testCount: 1 });
});
it("does not return a run outside the active project", async () => {
  expect((await detail(new Request("http://localhost"), { params: Promise.resolve({ runId: "foreign-run" }) })).status).toBe(404);
});

it("uses the client schema for standalone queued and blocked statuses", () => {
  for (const status of ["queued", "blocked"]) {
    expect(runSchema.parse({ id: "standalone", jobId: null, status })).toMatchObject({ jobId: null, status });
  }
});
it("counts and paginates executions once even if other report types exist", async () => {
  await client.unsafe("INSERT INTO reports VALUES ('browser-run', 'job', 'unrelated-report')");
  try {
    const response = await GET(new NextRequest("http://localhost/api/runs?limit=1&page=2"));
    const data = await response.json();
    expect(data.pagination.total).toBe(3);
    expect(data.data).toHaveLength(1);
    expect(data.data[0]).toMatchObject({ id: "browser-run", reportUrl: "browser-report" });
    expect(runSchema.safeParse(data.data[0]).success).toBe(true);
  } finally {
    await client.unsafe("DELETE FROM reports WHERE entity_id='browser-run' AND entity_type='job'");
  }
});
it("does not use another project's test title and retains run report fallback", async () => {
  await client.unsafe("INSERT INTO tests VALUES ('foreign-test', 'foreign', 'Private title')");
  await client.unsafe("UPDATE runs SET metadata='{\"testId\":\"foreign-test\",\"testType\":\"performance\"}', report_s3_url='fallback-report' WHERE id='load-run'");
  await client.unsafe("DELETE FROM reports WHERE entity_id='load-run'");
  try {
    const response = await GET(new NextRequest("http://localhost/api/runs?status=failed"));
    const data = await response.json();
    expect(data.pagination.total).toBe(1);
    expect(data.data[0]).toMatchObject({ jobName: "Deleted test", jobType: "k6", reportUrl: "fallback-report" });
  } finally {
    await client.unsafe("UPDATE runs SET metadata='{\"testId\":\"load\",\"testType\":\"performance\"}', report_s3_url=null WHERE id='load-run'");
    await client.unsafe("INSERT INTO reports VALUES ('load-run', 'k6_test', 'load-report')");
  }
});
