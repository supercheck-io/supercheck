/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `run_triggered_by_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const migration = readFileSync(join(__dirname, "0045_run_triggered_by.sql"), "utf8");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`
    CREATE TABLE "user" (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("adds triggered_by_user_id, nulls it when the user is deleted, and indexes only user-triggered runs", async () => {
  await client.unsafe(migration);
  await client.unsafe(migration);

  const [{ id: userId }] = await client`INSERT INTO "user" DEFAULT VALUES RETURNING id`;
  const [{ id: runId }] = await client`INSERT INTO runs (triggered_by_user_id) VALUES (${userId}) RETURNING id`;
  await client`DELETE FROM "user" WHERE id = ${userId}`;
  const [run] = await client`SELECT triggered_by_user_id FROM runs WHERE id = ${runId}`;
  expect(run.triggered_by_user_id).toBeNull();

  const [index] = await client`SELECT indexdef FROM pg_indexes WHERE indexname = 'runs_triggered_by_user_id_idx'`;
  expect(index.indexdef).toMatch(/WHERE \(triggered_by_user_id IS NOT NULL\)/);
});
