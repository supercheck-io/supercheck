/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `mr_exec_idx_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const migration = readFileSync(join(__dirname, "0073_monitor_results_test_execution_idx.sql"), "utf8");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`CREATE TABLE monitor_results (id text PRIMARY KEY, monitor_id text, test_execution_id text)`);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("is a no-transaction, idempotent concurrent build", () => {
  expect(migration).toMatch(/^-- supercheck:no-transaction$/m);
  expect(migration).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS "monitor_results_test_execution_id_idx"/);
});

it("lets the planner answer the execution id lookup from the index without a sequential scan", async () => {
  await client.unsafe(migration);
  await client.unsafe(migration);
  await client.unsafe(`INSERT INTO monitor_results SELECT g::text, 'm', CASE WHEN g % 2 = 0 THEN 'exec-' || g END FROM generate_series(1, 20000) g`);
  await client`ANALYZE monitor_results`;
  const sql = `SELECT id FROM monitor_results WHERE test_execution_id = 'exec-42' LIMIT 1`;
  const plan = (await client.unsafe(`EXPLAIN ${sql}`)).map((row) => row["QUERY PLAN"]).join("\n");
  expect(plan).toContain("monitor_results_test_execution_id_idx");
  expect(plan).not.toContain("Seq Scan");
});
