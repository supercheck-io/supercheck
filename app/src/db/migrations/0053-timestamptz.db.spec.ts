/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves migration 0053: every timestamp column
// becomes timestamptz with its stored UTC wall time kept as the same instant, defaults and indexes survive,
// and the migration refuses to run (changing nothing) when the database TimeZone is not UTC.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(APP_ROOT, "src/db/migrations");
const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) throw new Error("TEST_DATABASE_URL is required for database integration tests.");

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const names = { utc: `tstz_utc_${suffix}`, ny: `tstz_ny_${suffix}` };
let maintenance: ReturnType<typeof postgres>;
let workDir: string;
let beforeDir: string;
let target: string;
const orgIds: Record<string, string> = {};

const urlFor = (name: string) => {
  const url = new URL(maintenanceUrl);
  url.pathname = `/${name}`;
  return url.toString();
};
const migrate = (name: string) =>
  execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: beforeDir,
    env: { ...process.env, DATABASE_URL: urlFor(name), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
const withDb = async <T>(name: string, work: (db: ReturnType<typeof postgres>) => Promise<T>) => {
  const db = postgres(urlFor(name), { max: 1, onnotice: () => {} });
  try {
    return await work(db);
  } finally {
    await db.end({ timeout: 5 });
  }
};
const naiveCount = (db: ReturnType<typeof postgres>) =>
  db`SELECT count(*)::int AS count FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'`.then((r) => r[0].count as number);

beforeAll(async () => {
  workDir = mkdtempSync(path.join(os.tmpdir(), "timestamptz-"));
  beforeDir = path.join(workDir, "before");
  mkdirSync(path.join(beforeDir, "src/db"), { recursive: true });
  cpSync(MIGRATIONS_DIR, path.join(beforeDir, "src/db/migrations"), { recursive: true });
  target = readdirSync(MIGRATIONS_DIR).find((f) => f.startsWith("0053_") && f.endsWith(".sql")) as string;
  expect(target).toBeDefined();
  rmSync(path.join(beforeDir, "src/db/migrations", target));

  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  for (const name of Object.values(names)) await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  await maintenance.unsafe(`ALTER DATABASE "${names.utc}" SET TimeZone = 'UTC'`);
  await maintenance.unsafe(`ALTER DATABASE "${names.ny}" SET TimeZone = 'America/New_York'`);
  for (const name of Object.values(names)) {
    await migrate(name);
    await withDb(name, (db) =>
      db`INSERT INTO organization (id, name, created_at) VALUES (${(orgIds[name] = randomUUID())}, 'o', '2026-01-01 12:00:00')`,
    );
  }
}, 240_000);

afterAll(async () => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  for (const name of Object.values(names)) await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

const restore = () =>
  cpSync(path.join(MIGRATIONS_DIR, target), path.join(beforeDir, "src/db/migrations", target));

describe("0053_timestamptz", () => {
  it("keeps every instant, defaults and indexes when the database TimeZone is UTC", async () => {
    const before = await withDb(names.utc, async (db) => ({
      naive: await naiveCount(db),
      indexes: (await db`SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname = 'public'`)[0].count as number,
    }));
    expect(before.naive).toBeGreaterThan(200);
    restore();
    await migrate(names.utc);

    await withDb(names.utc, async (db) => {
      expect(await naiveCount(db)).toBe(0);
      const [{ count }] = await db`SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname = 'public'`;
      expect(count).toBe(before.indexes);
      const [row] = await db`SELECT created_at::text AS text, extract(epoch FROM created_at)::bigint AS epoch
        FROM organization WHERE id = ${orgIds[names.utc]}`;
      expect(row.text).toBe("2026-01-01 12:00:00+00");
      expect(Number(row.epoch)).toBe(Date.UTC(2026, 0, 1, 12) / 1000);
      // Defaults still work and a UTC session reads them back as UTC.
      const [project] = await db`INSERT INTO projects (id, organization_id, name) VALUES (${randomUUID()}, ${orgIds[names.utc]}, 'd') RETURNING created_at`;
      expect(Math.abs(Date.now() - new Date(project.created_at).getTime())).toBeLessThan(60_000);
    });
  }, 180_000);

  it("refuses to run when the database TimeZone is not UTC and converts nothing", async () => {
    const naive = await withDb(names.ny, naiveCount);
    restore();
    await expect(migrate(names.ny)).rejects.toMatchObject({
      stderr: expect.stringContaining("requires the database session TimeZone to be UTC"),
    });
    await withDb(names.ny, async (db) => {
      expect(await naiveCount(db)).toBe(naive);
      const [row] = await db`SELECT created_at::text AS text FROM organization WHERE id = ${orgIds[names.ny]}`;
      expect(row.text).toBe("2026-01-01 12:00:00");
    });
  }, 180_000);
});
