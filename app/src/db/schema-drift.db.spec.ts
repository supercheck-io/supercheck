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

const SIGNATURE_SQL = `
  SELECT 'COL ' || c.table_name || '.' || c.column_name || ' ' || c.data_type
    || coalesce('(' || c.character_maximum_length || ')', '')
    || ' null=' || c.is_nullable || ' def=' || coalesce(c.column_default, '-') AS sig
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name <> '__drizzle_migrations'
  UNION ALL
  SELECT 'CON ' || conrelid::regclass::text || ' ' || contype::text || ' '
    || regexp_replace(pg_get_constraintdef(oid), '\\s+', ' ', 'g')
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace AND contype <> 'n'
    AND conrelid::regclass::text <> '__drizzle_migrations'
  UNION ALL
  SELECT 'IDX ' || tablename || ' ' || regexp_replace(indexdef, 'INDEX \\S+ ON ', 'INDEX ON ')
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
    AND indexname NOT IN (SELECT conname FROM pg_constraint)
`;

function normalize(signature: string): string | null {
  const table = signature.split(" ")[1]?.split(".")[0]?.replace(/^public\./, "");
  if (table && MIGRATION_ONLY_TABLES.has(table)) return null;
  const match = /^(COL \S+\.id uuid\(?\)? ?null=NO def=)(.*)$/.exec(signature);
  if (match && (match[2] === "-" || DB_UUID_DEFAULTS.has(match[2]))) {
    return `${match[1]}<db-uuid>`;
  }
  return signature;
}

async function signatures(url: string): Promise<Set<string>> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await client.unsafe<{ sig: string }[]>(SIGNATURE_SQL);
    return new Set(rows.map((row) => normalize(row.sig)).filter((s): s is string => s !== null));
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
      const onlyInMigrations = [...fromMigrations].filter((sig) => !fromSchema.has(sig)).sort();
      const onlyInSchema = [...fromSchema].filter((sig) => !fromMigrations.has(sig)).sort();

      // On failure, the lists name exactly what to add to a migration or to src/db/schema.
      expect({ onlyInMigrations, onlyInSchema }).toEqual({ onlyInMigrations: [], onlyInSchema: [] });
    },
    180_000,
  );
});
