/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Runs the real waiter helpers (src/lib/sre/private-agent-job-cancel.ts) against Postgres.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const APP_ROOT = path.resolve(__dirname, "../..");
const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) throw new Error("TEST_DATABASE_URL is required for database integration tests.");

const databaseName = `waiters_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let helpers: typeof import("@/lib/sre/private-agent-job-cancel");

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(maintenanceUrl);
  target.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
  const schema = await import("@/db/schema");
  jest.doMock("@/utils/db", () => ({ db: drizzle(sql, { schema }) }));
  helpers = await import("@/lib/sre/private-agent-job-cancel");
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const id = () => randomUUID();
const org = id();
const proj = id();

// FK triggers off so only the columns under test need values; the helpers run with them on.
async function seedJob(status: string, waiters: number) {
  const jid = id();
  await sql.unsafe("SET session_replication_role = replica");
  try {
    await sql.unsafe(
      `INSERT INTO private_agent_jobs (id, organization_id, project_id, private_agent_id, job_class, status, authorized_by, policy_decision_hash, job_spec_hash, idempotency_key, waiters) VALUES ('${jid}','${org}','${proj}','${id()}','sre_connector_query','${status}','agent','h','h','${jid}',${waiters})`,
    );
  } finally {
    await sql.unsafe("SET session_replication_role = DEFAULT");
  }
  return { jobId: jid, organizationId: org, projectId: proj };
}
const row = async (jobId: string) =>
  (await sql.unsafe(`SELECT status, waiters, error_code, completed_at, created_at FROM private_agent_jobs WHERE id = '${jobId}'`))[0];

describe("private agent job waiters", () => {
  it("only the last waiter out cancels a queued job", async () => {
    const ref = await seedJob("queued", 2);
    await expect(helpers.releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
    expect(await row(ref.jobId)).toMatchObject({ status: "queued", waiters: 1, error_code: null, completed_at: null });
    await expect(helpers.releasePrivateAgentJobWaiter(ref)).resolves.toBe(true);
    const cancelled = await row(ref.jobId);
    expect(cancelled).toMatchObject({ status: "cancelled", waiters: 0, error_code: "wait_abandoned" });
    expect(cancelled.completed_at).not.toBeNull();
  });

  it("does not cancel a job an agent already leased", async () => {
    const ref = await seedJob("leased", 1);
    await expect(helpers.releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
    expect(await row(ref.jobId)).toMatchObject({ status: "leased", waiters: 0, error_code: null });
  });

  it("is scoped to the owning organization and project", async () => {
    const ref = await seedJob("queued", 1);
    await expect(helpers.releasePrivateAgentJobWaiter({ ...ref, organizationId: id() })).resolves.toBe(false);
    await expect(helpers.releasePrivateAgentJobWaiter({ ...ref, projectId: id() })).resolves.toBe(false);
    await helpers.joinPrivateAgentJob({ ...ref, organizationId: id() });
    expect(await row(ref.jobId)).toMatchObject({ status: "queued", waiters: 1 });
  });

  it("a joiner adds a waiter, so the first caller leaving no longer cancels", async () => {
    const ref = await seedJob("queued", 1);
    await helpers.joinPrivateAgentJob(ref);
    expect((await row(ref.jobId)).waiters).toBe(2);
    await expect(helpers.releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
    expect(await row(ref.jobId)).toMatchObject({ status: "queued", waiters: 1 });
  });

  it("a joiner revives a job cancelled as abandoned, as its only waiter", async () => {
    const ref = await seedJob("queued", 1);
    await helpers.releasePrivateAgentJobWaiter(ref);
    const before = Date.parse(String((await row(ref.jobId)).created_at));
    await helpers.joinPrivateAgentJob(ref);
    const revived = await row(ref.jobId);
    expect(revived).toMatchObject({ status: "queued", waiters: 1, error_code: null, completed_at: null });
    expect(Date.parse(String(revived.created_at))).toBeGreaterThanOrEqual(before);
  });

  it("a joiner leaves a job cancelled for another reason alone", async () => {
    const ref = await seedJob("cancelled", 0);
    await helpers.joinPrivateAgentJob(ref);
    expect(await row(ref.jobId)).toMatchObject({ status: "cancelled", error_code: null });
  });
});
