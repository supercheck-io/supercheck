/** @jest-environment node */
/**
 * Schema drift guard: the database built by the real migrations must match the
 * database described by `src/db/schema/*.ts`.
 *
 * Migrations from 0015 onward are hand-written SQL, so nothing else proves that
 * a column, constraint or index added in one place was also added in the other.
 * This suite builds two throwaway databases, one from `scripts/db-migrate.js`
 * and one from `drizzle-kit generate` output, and compares catalog signatures
 * (columns, constraints, indexes).
 *
 * Run with: TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);

const APP_ROOT = path.resolve(__dirname, "../..");
const SCHEMA_DIR = path.join(APP_ROOT, "src/db/schema");

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) {
  throw new Error("TEST_DATABASE_URL is required for database integration tests.");
}

/**
 * Tables that exist only in migrations on purpose.
 * - monitor_aggregate_dedup_audit: forensic copy of rows removed by 0033; never read by the app.
 */
const MIGRATION_ONLY_TABLES = new Set(["monitor_aggregate_dedup_audit"]);

/**
 * Primary keys declared with `$defaultFn(() => sql\`uuidv7()\`)` are generated in
 * the INSERT by Drizzle, while the migrations also set a column default. Both
 * produce a database-generated uuid, so the default itself is not compared.
 */
const DB_UUID_DEFAULTS = new Set(["uuidv7()", "gen_random_uuid()"]);

// Compared: column type (format_type keeps array element, enum and precision),
// nullability and default; constraint definitions; index names and definitions.
// Not compared: constraint names (hand-written migrations use Postgres default
// `_fkey` names, so a migration that drops a constraint must use the name in the
// database, not the Drizzle name), sequences, triggers, functions, comments.
const SIGNATURE_SQL = `
  SELECT 'COL ' || cl.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    || ' null=' || CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END
    || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
    || CASE WHEN a.attidentity <> '' THEN ' identity=' || a.attidentity::text ELSE '' END AS sig
  FROM pg_attribute a
  JOIN pg_class cl ON cl.oid = a.attrelid AND cl.relkind = 'r'
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE cl.relnamespace = 'public'::regnamespace AND cl.relname <> '__drizzle_migrations'
    AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'CON ' || conrelid::regclass::text || ' ' || contype::text || ' '
    || regexp_replace(pg_get_constraintdef(oid), '\\s+', ' ', 'g')
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
    AND conrelid::regclass::text <> '__drizzle_migrations'
  UNION ALL
  SELECT 'IDX ' || t.relname || ' ' || pg_get_indexdef(i.indexrelid)
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  WHERE t.relnamespace = 'public'::regnamespace AND t.relname <> '__drizzle_migrations'
    AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)
`;

function normalize(signature: string): string | null {
  const table = signature.split(" ")[1]?.split(".")[0];
  if (table && MIGRATION_ONLY_TABLES.has(table)) return null;
  const match = /^(COL \S+\.id uuid null=NO def=)(.*)$/.exec(signature);
  if (match && (match[2] === "-" || DB_UUID_DEFAULTS.has(match[2]))) {
    return `${match[1]}<db-uuid>`;
  }
  return signature;
}

// Multiset difference: duplicate signatures (e.g. two identically defined CHECKs) must also match.
function difference(left: string[], right: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const sig of right) remaining.set(sig, (remaining.get(sig) ?? 0) + 1);
  return left.filter((sig) => {
    const count = remaining.get(sig) ?? 0;
    if (count > 0) remaining.set(sig, count - 1);
    return count === 0;
  });
}

async function signatures(url: string): Promise<string[]> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await client.unsafe<{ sig: string }[]>(SIGNATURE_SQL);
    return rows.map((row) => normalize(row.sig)).filter((s): s is string => s !== null);
  } finally {
    await client.end({ timeout: 5 });
  }
}

function databaseUrlFor(name: string): string {
  const target = new URL(maintenanceUrl as string);
  target.pathname = `/${name}`;
  return target.toString();
}

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const migratedDb = `drift_migrated_${suffix}`;
const declaredDb = `drift_declared_${suffix}`;
let maintenanceClient: ReturnType<typeof postgres>;
let workDir: string;

beforeAll(async () => {
  maintenanceClient = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenanceClient.unsafe(`CREATE DATABASE "${migratedDb}"`);
  await maintenanceClient.unsafe(`CREATE DATABASE "${declaredDb}"`);
  workDir = mkdtempSync(path.join(os.tmpdir(), "schema-drift-"));
});

afterAll(async () => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  if (!maintenanceClient) return;
  await maintenanceClient.unsafe(`DROP DATABASE IF EXISTS "${migratedDb}" WITH (FORCE)`);
  await maintenanceClient.unsafe(`DROP DATABASE IF EXISTS "${declaredDb}" WITH (FORCE)`);
  await maintenanceClient.end({ timeout: 5 });
});

describe("schema drift", () => {
  it("reports a duplicated signature that only one side has twice", () => {
    const check = "CON tests c CHECK ((priority = ANY (ARRAY['low'::text])))";
    expect(difference([check, check, "COL tests.id uuid"], [check, "COL tests.id uuid"])).toEqual([check]);
    expect(difference([check], [check, check])).toEqual([]);
  });

  it(
    "migrations produce exactly the schema declared in src/db/schema",
    async () => {
      await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
        cwd: APP_ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrlFor(migratedDb), SELF_HOSTED: "true", NODE_ENV: "test" },
        timeout: 90_000,
      });

      // Spec files live next to the schema and must not be loaded by drizzle-kit.
      const schemaFiles = readdirSync(SCHEMA_DIR)
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
        .map((file) => path.join(SCHEMA_DIR, file));
      const configPath = path.join(workDir, "drizzle.drift.config.js");
      writeFileSync(
        configPath,
        `module.exports = ${JSON.stringify({ dialect: "postgresql", schema: schemaFiles, out: path.join(workDir, "out") })};`,
      );
      await execFileAsync(
        process.execPath,
        [path.join(APP_ROOT, "node_modules/drizzle-kit/bin.cjs"), "generate", `--config=${configPath}`, "--name=declared"],
        { cwd: APP_ROOT, timeout: 90_000 },
      );
      const generated = readdirSync(path.join(workDir, "out")).find((file) => file.endsWith(".sql"));
      const declaredSql = readFileSync(path.join(workDir, "out", generated as string), "utf8");
      const declared = postgres(databaseUrlFor(declaredDb), { max: 1, onnotice: () => {} });
      try {
        for (const statement of declaredSql.split("--> statement-breakpoint")) {
          if (statement.trim()) await declared.unsafe(statement);
        }
      } finally {
        await declared.end({ timeout: 5 });
      }

      const fromMigrations = await signatures(databaseUrlFor(migratedDb));
      const fromSchema = await signatures(databaseUrlFor(declaredDb));
      const onlyInMigrations = difference(fromMigrations, fromSchema).sort();
      const onlyInSchema = difference(fromSchema, fromMigrations).sort();

      // On failure, the lists name exactly what to add to a migration or to src/db/schema.
      expect({ onlyInMigrations, onlyInSchema }).toEqual({ onlyInMigrations: [], onlyInSchema: [] });
    },
    180_000,
  );
});
