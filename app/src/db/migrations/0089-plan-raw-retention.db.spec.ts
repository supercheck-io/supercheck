/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// 0089 moves stock Pro raw retention from 7 to 30 days, leaves Plus and custom values alone, and a rerun changes nothing.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `raw_retention_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const migrationSql = readFileSync(path.join(APP_ROOT, "src/db/migrations/0089_plan_raw_retention.sql"), "utf8");
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const retention = async () =>
  Object.fromEntries(
    (await client`SELECT plan, data_retention_days FROM plan_limits WHERE plan IN ('plus', 'pro')`).map((row) => [
      row.plan,
      row.data_retention_days,
    ])
  );

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 120_000,
  });
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("a fresh database seeds the new values", async () => {
  expect(await retention()).toEqual({ plus: 7, pro: 30 });
});

it("moves stock Pro from 7 to 30 days and leaves Plus at 7", async () => {
  await client`UPDATE plan_limits SET data_retention_days = 7 WHERE plan IN ('plus', 'pro')`;
  await client.unsafe(migrationSql);
  expect(await retention()).toEqual({ plus: 7, pro: 30 });
});

it("keeps custom values, and a rerun is a no-op", async () => {
  await client`UPDATE plan_limits SET data_retention_days = CASE plan WHEN 'plus' THEN 14 ELSE 45 END WHERE plan IN ('plus', 'pro')`;
  await client.unsafe(migrationSql);
  await client.unsafe(migrationSql);
  expect(await retention()).toEqual({ plus: 14, pro: 45 });
});
