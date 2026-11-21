/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// 0090 tunes autovacuum on the high-churn monitor tables when the migrating role owns them, and otherwise (another
// owner, or a table locked past the timeout) leaves a WARNING (printed by the migration runner) and changes nothing, without failing the deploy.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const databaseName = `autovacuum_${suffix}`;
const outsider = `autovacuum_outsider_${suffix}`;
const TABLES = ["monitor_results", "monitor_aggregates", "monitor_cycles"];
const TUNED = ["autovacuum_vacuum_scale_factor=0.02", "autovacuum_analyze_scale_factor=0.01"];
const migrationSql = readFileSync(path.join(APP_ROOT, "src/db/migrations/0090_high_churn_autovacuum.sql"), "utf8");
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let url: URL;
const notices: string[] = [];

const reloptions = async () =>
  Object.fromEntries(
    (await client`SELECT relname, coalesce(reloptions, '{}') AS options FROM pg_class WHERE relname IN ${client(TABLES)} AND relkind = 'r'`).map(
      (row) => [row.relname, row.options],
    ),
  );
const reset = () =>
  client.unsafe(
    TABLES.map((t) => `ALTER TABLE ${t} RESET (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);`).join("\n"),
  );

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  await maintenance.unsafe(`CREATE ROLE "${outsider}" NOLOGIN`);
  url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 2, onnotice: (notice) => void notices.push(notice.message) });
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 120_000,
  });
  await client.unsafe(`GRANT USAGE ON SCHEMA public TO "${outsider}"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${outsider}"`);
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.unsafe(`DROP ROLE IF EXISTS "${outsider}"`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(() => {
  notices.length = 0;
});

it("a fresh database has the tuned settings on all three tables", async () => {
  const options = await reloptions();
  for (const table of TABLES) expect(options[table]).toEqual(TUNED);
});

it("applies the settings as the owner, and a rerun is a no-op", async () => {
  await reset();
  await client.unsafe(migrationSql);
  await client.unsafe(migrationSql);
  const options = await reloptions();
  for (const table of TABLES) expect(options[table]).toEqual(TUNED);
  expect(notices).toEqual([]);
});

it("as a role that does not own the tables: WARNING, unchanged, no error", async () => {
  await reset();
  await client.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE "${outsider}"`);
    await tx.unsafe(migrationSql);
  });
  const options = await reloptions();
  for (const table of TABLES) expect(options[table]).toEqual([]);
  expect(notices).toHaveLength(3);
  expect(notices[0]).toContain("does not own it");
});

it("skips a table that stays locked, tunes the others and restores the caller's lock timeout", async () => {
  await reset();
  const holder = postgres(url.toString(), { max: 1, onnotice: () => {} });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holding = holder.begin(async (tx) => {
    await tx`LOCK TABLE monitor_aggregates IN ACCESS EXCLUSIVE MODE`;
    locked();
    await held;
  });
  try {
    // A failed LOCK rejects the holder instead of leaving the test waiting for its timeout.
    await Promise.race([isLocked, holding]);
    const [after] = await client.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '30s'`;
      await tx.unsafe(migrationSql);
      return tx`SELECT current_setting('lock_timeout') AS value`;
    });
    expect(after.value).toBe("30s");
  } finally {
    release();
    try {
      await holding;
    } finally {
      await holder.end({ timeout: 5 });
    }
  }
  const options = await reloptions();
  expect(options.monitor_results).toEqual(TUNED);
  expect(options.monitor_cycles).toEqual(TUNED);
  expect(options.monitor_aggregates).toEqual([]);
  expect(notices).toEqual([expect.stringContaining("monitor_aggregates not applied: table is locked")]);
}, 30_000);

it("passes the migration safety check", async () => {
  await expect(
    execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/check-migration-safety.js"), "--journal", "src/db/migrations", "src/db/migrations/0090_high_churn_autovacuum.sql"], { cwd: APP_ROOT }),
  ).resolves.toEqual(expect.objectContaining({ stdout: expect.stringContaining("passed") }));
});
