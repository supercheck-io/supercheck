/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `gmail_trial_key_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const migration = readFileSync(join(__dirname, "0062_gmail_trial_key_index.sql"), "utf8");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`CREATE TABLE "user" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, trial_granted_at timestamptz)`);
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
  expect(migration).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_gmail_trial_key_idx"/);
});

it("serves the alias lookup of the setup-defaults route", async () => {
  await client.unsafe(migration);
  await client.unsafe(migration);
  await client`INSERT INTO "user" (email, trial_granted_at) VALUES ('a.b+x@gmail.com', now()), ('other@example.com', now()), ('ab@gmail.com', NULL)`;
  await client`ANALYZE "user"`;

  // The route's filter, verbatim apart from the parameter. Seq scans are disabled so only an index can answer.
  await client`SET enable_seqscan = off`;
  const query = (key: string) => client`
    SELECT id FROM "user" WHERE trial_granted_at IS NOT NULL
      AND split_part(lower(email), '@', 2) IN ('gmail.com', 'googlemail.com')
      AND replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') = ${key}`;
  expect(await query("ab")).toHaveLength(1);
  const plan = await client`EXPLAIN ${client.unsafe(`SELECT id FROM "user" WHERE trial_granted_at IS NOT NULL
      AND split_part(lower(email), '@', 2) IN ('gmail.com', 'googlemail.com')
      AND replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') = 'ab'`)}`;
  expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("user_gmail_trial_key_idx");
});
