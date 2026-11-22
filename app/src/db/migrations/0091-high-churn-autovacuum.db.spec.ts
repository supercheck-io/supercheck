/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// 0091 adds monitors.raw_purged_before (the raw purge watermark the rollup relies on, so it is required: a locked
// table fails the migration within the bounded lock timeout). It then tunes autovacuum on the high-churn monitor
// tables when the migrating role owns them, and otherwise (another owner, or a table locked past the timeout) leaves
// a WARNING (printed by the migration runner) and changes nothing, without failing the deploy.
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
const migrationSql = readFileSync(path.join(APP_ROOT, "src/db/migrations/0091_high_churn_autovacuum.sql"), "utf8");
// The runner applies a file statement by statement (split on the breakpoint), as here.
const statements = migrationSql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
const columnSql = statements.find((s) => s.includes("raw_purged_before"))!;
const autovacuumSql = statements.find((s) => s.includes("autovacuum_vacuum_scale_factor"))!;
const COLUMN_EXISTS = 'column "raw_purged_before" of relation "monitors" already exists, skipping';
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

it("a fresh database has monitors.raw_purged_before as a nullable timestamptz", async () => {
  const columns = await client`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'monitors' AND column_name = 'raw_purged_before'`;
  expect(columns).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]);
});

it("applies the settings as the owner, and a rerun is a no-op", async () => {
  await reset();
  await client.begin(async (tx) => {
    await tx.unsafe(migrationSql);
    await tx.unsafe(migrationSql);
  });
  const options = await reloptions();
  for (const table of TABLES) expect(options[table]).toEqual(TUNED);
  // The column is already there: PostgreSQL says so and skips it; the autovacuum step is silent.
  expect(notices).toEqual([COLUMN_EXISTS, COLUMN_EXISTS]);
});

it("the column step fails within the bounded lock timeout while monitors stays locked, and restores the caller's timeout otherwise", async () => {
  const holder = postgres(url.toString(), { max: 1, onnotice: () => {} });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holding = holder.begin(async (tx) => {
    await tx`LOCK TABLE monitors IN ACCESS EXCLUSIVE MODE`;
    locked();
    await held;
  });
  try {
    await Promise.race([isLocked, holding]);
    const started = Date.now();
    await expect(
      client.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '30s'`;
        await tx.unsafe(columnSql);
      }),
    ).rejects.toMatchObject({ code: "55P03" });
    expect(Date.now() - started).toBeLessThan(20_000);
  } finally {
    release();
    try {
      await holding;
    } finally {
      await holder.end({ timeout: 5 });
    }
  }
  const [after] = await client.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '30s'`;
    await tx.unsafe(columnSql);
    return tx`SELECT current_setting('lock_timeout') AS value`;
  });
  expect(after.value).toBe("30s");
}, 30_000);

it("as a role that does not own the tables: WARNING, unchanged, no error", async () => {
  await reset();
  await client.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE "${outsider}"`);
    await tx.unsafe(autovacuumSql);
  });
  const options = await reloptions();
  for (const table of TABLES) expect(options[table]).toEqual([]);
  expect(notices).toHaveLength(3);
  expect(notices[0]).toContain("does not own it");
  // The column is required, so its step is not optional: a role that cannot alter monitors fails the migration.
  await expect(
    client.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE "${outsider}"`);
      await tx.unsafe(columnSql);
    }),
  ).rejects.toMatchObject({ code: "42501" });
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
  expect(notices).toEqual([COLUMN_EXISTS, expect.stringContaining("monitor_aggregates not applied: table is locked")]);
}, 30_000);

it("passes the migration safety check", async () => {
  await expect(
    execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/check-migration-safety.js"), "--journal", "src/db/migrations", "src/db/migrations/0091_high_churn_autovacuum.sql"], { cwd: APP_ROOT }),
  ).resolves.toEqual(expect.objectContaining({ stdout: expect.stringContaining("passed") }));
});
