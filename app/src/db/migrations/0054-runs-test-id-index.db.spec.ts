/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const INDEX = "runs_metadata_test_id_created_at_idx";
const databaseName = `runs_test_id_idx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let databaseUrl: string;

const migrate = () =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });

const indexState = async () =>
  (await client<{ valid: boolean }[]>`
    SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ${INDEX}
  `).map((row) => row.valid);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
}, 30_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("builds the index after the migration transaction and records the file only on success", async () => {
  await migrate();
  expect(await indexState()).toEqual([true]);
  const [{ count }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM "__drizzle_migrations"`;
  expect(count).toBeGreaterThan(50);
  const hash0054 = createHash("md5")
    .update(readFileSync(path.join(APP_ROOT, "src/db/migrations/0054_runs_test_id_index.sql"), "utf8"))
    .digest("hex");
  const recorded = await client<{ hash: string }[]>`SELECT hash FROM "__drizzle_migrations" WHERE hash = ${hash0054}`;
  expect(recorded).toHaveLength(1);
  await migrate(); // a second deploy is a no-op
  expect(await indexState()).toEqual([true]);
  const [{ count: again }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM "__drizzle_migrations"`;
  expect(again).toBe(count);
}, 180_000);

it("drops an INVALID index left by an interrupted build and rebuilds it", async () => {
  await migrate(); // self-contained: do not rely on an earlier test having migrated this database
  // Simulate the leftover of a failed CONCURRENTLY build and an unrecorded migration.
  await client.unsafe(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${INDEX}'::regclass`);
  // By hash, not max(id): later no-transaction migrations are recorded after 0054.
  const hash0054 = createHash("md5")
    .update(readFileSync(path.join(APP_ROOT, "src/db/migrations/0054_runs_test_id_index.sql"), "utf8"))
    .digest("hex");
  const [{ before }] = await client<{ before: number }[]>`SELECT count(*)::int AS before FROM "__drizzle_migrations"`;
  await client`DELETE FROM "__drizzle_migrations" WHERE hash = ${hash0054}`;
  expect(await indexState()).toEqual([false]);

  await migrate();
  expect(await indexState()).toEqual([true]);
  const [{ count }] = await client<{ count: number }[]>`SELECT count(*)::int AS count FROM "__drizzle_migrations"`;
  expect(count).toBe(before);
}, 180_000);

it("does not fail the run or record the file when a deferred build fails", async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "deferred-fail-"));
  try {
    cpSync(path.join(APP_ROOT, "src/db/migrations"), path.join(work, "src/db/migrations"), { recursive: true });
    const bad = "-- supercheck:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS bad_deferred_idx ON no_such_table (x);\n";
    writeFileSync(path.join(work, "src/db/migrations/0099_bad_deferred.sql"), bad);
    const { stdout } = await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
      cwd: work,
      env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test" },
      timeout: 90_000,
    });
    expect(stdout).toMatch(/Deferred migration 0099_bad_deferred.sql failed and will be retried/);
    const hash = require("node:crypto").createHash("md5").update(bad).digest("hex");
    expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${hash}`).toHaveLength(0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 180_000);

it("lets a build finish while another pod polls for the migration lock", async () => {
  const { acquireMigrationLock } = require("../../../scripts/migration-lock") as typeof import("../../../scripts/migration-lock");
  process.env.SELF_HOSTED = "true"; // the lock module reads the TLS mode from the environment
  const holder = await acquireMigrationLock(postgres, databaseUrl, { lockName: "waiter-test", timeoutMs: 5_000 });
  expect(holder).not.toBeNull();
  // The second pod polls (BEGIN + try-lock) while the first runs its deferred build.
  const waiter = acquireMigrationLock(postgres, databaseUrl, { lockName: "waiter-test", timeoutMs: 20_000, retryDelayMs: 100 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const builder = postgres(databaseUrl, { max: 1, onnotice: () => {}, connection: { statement_timeout: 15_000 } });
  try {
    await builder.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS waiter_probe_idx ON runs ((metadata->>'probe'))`);
  } finally {
    await builder.end({ timeout: 5 });
  }
  expect(await client`SELECT 1 FROM pg_indexes WHERE indexname = 'waiter_probe_idx'`).toHaveLength(1);

  await holder.unsafe("ROLLBACK");
  await holder.end();
  const acquired = await waiter;
  expect(acquired).not.toBeNull();
  await acquired.unsafe("ROLLBACK");
  await acquired.end();
}, 60_000);

it("treats a build that exceeds the statement timeout as failed: warns, exits 0 and stays unrecorded", async () => {
  const hash = require("node:crypto")
    .createHash("md5")
    .update(readFileSync(path.join(APP_ROOT, "src/db/migrations/0054_runs_test_id_index.sql"), "utf8"))
    .digest("hex");
  await client.unsafe(`DROP INDEX IF EXISTS ${INDEX}`);
  await client`DELETE FROM "__drizzle_migrations" WHERE hash = ${hash}`;

  // An open writer on runs makes CREATE INDEX CONCURRENTLY wait, so only the statement timeout ends it.
  const writer = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await writer.unsafe("BEGIN");
    await writer.unsafe("LOCK TABLE runs IN ROW EXCLUSIVE MODE");
    const { stdout } = await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
      cwd: APP_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl, SELF_HOSTED: "true", NODE_ENV: "test", DB_DEFERRED_MIGRATION_TIMEOUT_MS: "1500" },
      timeout: 90_000,
    });
    expect(stdout).toMatch(/Deferred migration 0054_runs_test_id_index.sql failed and will be retried/);
  } finally {
    await writer.unsafe("ROLLBACK").catch(() => undefined);
    await writer.end({ timeout: 5 });
  }
  // A cancelled build may leave an INVALID index; the file itself stays unrecorded.
  expect((await indexState()).filter(Boolean)).toHaveLength(0);
  expect(await client`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${hash}`).toHaveLength(0);

  await migrate(); // the next deploy drops the invalid index and rebuilds
  expect(await indexState()).toEqual([true]);
}, 180_000);
