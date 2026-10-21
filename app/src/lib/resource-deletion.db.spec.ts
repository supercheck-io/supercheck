import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
let mockDatabase: ReturnType<typeof drizzle>;
const mockDeleteReports = jest.fn();
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({ getRunArtifactInputs: () => [], deleteReports: (...args: unknown[]) => mockDeleteReports(...args) }) }));
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
  mockDatabase = drizzle(client);
  await client.unsafe(`
    CREATE TABLE runs (id text PRIMARY KEY, project_id text, job_id text, status text, trigger text, started_at timestamptz, report_s3_url text, logs_s3_url text, metadata jsonb);
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
beforeEach(() => mockDeleteReports.mockResolvedValue({ success: true }));
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
