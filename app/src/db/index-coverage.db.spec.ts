/** @jest-environment node */
/**
 * Index coverage contract against a real, disposable PostgreSQL database.
 *
 * Every foreign key column must lead a usable index (otherwise a parent delete or a join
 * scans the child table), and no plain index may be fully covered by another one.
 *
 * Run explicitly: TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../..");

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) {
  throw new Error("TEST_DATABASE_URL is required for database integration tests.");
}

// FK columns deliberately left without an index: append-only, high write rate tables whose
// parent (a user) is effectively never deleted, so an index would cost more than it saves.
const UNINDEXED_FK_ALLOWLIST = new Set([
  "audit_logs.user_id",
  "sre_incident_timeline_events.actor_user_id",
]);

// No redundant index is tolerated; add "index_name" here only with a written reason.
const REDUNDANT_INDEX_ALLOWLIST = new Set<string>([]);

const databaseName = `supercheck_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let maintenanceClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof postgres>;

beforeAll(async () => {
  maintenanceClient = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenanceClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(maintenanceUrl);
  target.pathname = `/${databaseName}`;
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  db = postgres(target.toString(), { max: 1, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await db?.end({ timeout: 5 });
  if (!maintenanceClient) return;
  await maintenanceClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenanceClient.end({ timeout: 5 });
});

describe("index coverage", () => {
  it("every foreign key column leads a usable index", async () => {
    // A partial index counts only when it is `col IS NOT NULL`, which any `col = $1` lookup implies.
    const rows = await db<{ ref: string }[]>`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS ref
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1] AND i.indisvalid
            AND i.indexprs IS NULL
            AND (i.indpred IS NULL
                 OR pg_get_expr(i.indpred, i.indrelid) = '(' || a.attname || ' IS NOT NULL)')
        )
      ORDER BY 1`;
    const unexpected = rows.map((r) => r.ref).filter((r) => !UNINDEXED_FK_ALLOWLIST.has(r));
    expect(unexpected).toEqual([]);
  });

  it("no plain index is a leading prefix of another index on the same table", async () => {
    const rows = await db<{ redundant: string; covered_by: string }[]>`
      SELECT a.indexrelid::regclass::text AS redundant, b.indexrelid::regclass::text AS covered_by
      FROM pg_index a
      JOIN pg_index b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
      WHERE NOT a.indisunique AND NOT a.indisprimary AND a.indpred IS NULL AND b.indpred IS NULL
        AND a.indexprs IS NULL AND b.indexprs IS NULL
        AND a.indnatts <= b.indnatts
        AND (a.indkey::int2[])[0:a.indnatts-1] = (b.indkey::int2[])[0:a.indnatts-1]
        AND (a.indoption::int2[])[0:a.indnatts-1] = (b.indoption::int2[])[0:a.indnatts-1]
        AND (a.indnatts < b.indnatts OR a.indexrelid > b.indexrelid)
        AND a.indrelid::regclass::text <> '__drizzle_migrations'
      ORDER BY 1`;
    const unexpected = rows.filter((r) => !REDUNDANT_INDEX_ALLOWLIST.has(r.redundant));
    expect(unexpected).toEqual([]);
  });

  it("no plain single-column index duplicates a `col IS NOT NULL` partial index", async () => {
    const rows = await db<{ redundant: string }[]>`
      SELECT full_idx.indexrelid::regclass::text AS redundant
      FROM pg_index full_idx
      JOIN pg_index part ON part.indrelid = full_idx.indrelid AND part.indnatts = 1
        AND part.indkey[0] = full_idx.indkey[0] AND part.indexprs IS NULL
      JOIN pg_attribute a ON a.attrelid = full_idx.indrelid AND a.attnum = full_idx.indkey[0]
      WHERE full_idx.indnatts = 1 AND full_idx.indpred IS NULL AND full_idx.indexprs IS NULL
        AND NOT full_idx.indisunique AND NOT full_idx.indisprimary
        AND pg_get_expr(part.indpred, part.indrelid) = '(' || a.attname || ' IS NOT NULL)'
      ORDER BY 1`;
    expect(rows.map((r) => r.redundant)).toEqual([]);
  });

  it("every allowlisted foreign key is still unindexed", async () => {
    // Keeps the allowlist honest: remove an entry once its column gets an index.
    const rows = await db<{ ref: string }[]>`
      SELECT c.conrelid::regclass::text || '.' || a.attname AS ref
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`;
    const indexed = new Set(rows.map((r) => r.ref));
    expect([...UNINDEXED_FK_ALLOWLIST].filter((ref) => indexed.has(ref))).toEqual([]);
  });
});
