/** @jest-environment node */
/**
 * The OAuth/MCP migration is hand-written SQL while the application reads the
 * tables through Drizzle definitions. This applies the real migrations to a
 * disposable database and checks both agree on every column, so a mismatch
 * fails here instead of as a runtime error on the first OAuth request.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { getTableConfig, PgColumn } from "drizzle-orm/pg-core";
import { oauthSchema } from "./schema/oauth";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../..");

const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests. " +
      "Example: TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run test:db",
  );
}

const databaseName = `supercheck_oauth_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let db: ReturnType<typeof postgres>;

function urlFor(name: string): string {
  const url = new URL(maintenanceUrl as string);
  url.pathname = `/${name}`;
  return url.toString();
}

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl as string, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(urlFor(databaseName));
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DB_HOST: url.hostname,
      DB_PORT: url.port || "5432",
      DB_USER: decodeURIComponent(url.username || "postgres"),
      DB_PASSWORD: decodeURIComponent(url.password || ""),
      DB_NAME: databaseName,
      SELF_HOSTED: "true",
    },
    timeout: 120_000,
  });
  db = postgres(urlFor(databaseName), { max: 1, onnotice: () => {} });
}, 180_000);

afterAll(async () => {
  await db?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

function expectedType(column: PgColumn): string {
  const type = column.getSQLType();
  if (type.startsWith("timestamp")) return "timestamp without time zone";
  if (type === "uuid") return "uuid";
  if (type === "text") return "text";
  if (type === "boolean") return "boolean";
  if (type === "integer") return "integer";
  if (type === "jsonb") return "jsonb";
  if (type.endsWith("[]")) return "ARRAY";
  throw new Error(`Unhandled column type ${type}`);
}

describe("OAuth / MCP tables", () => {
  it.each(Object.entries(oauthSchema))(
    "%s matches its Drizzle definition column for column",
    async (_model, table) => {
      const config = getTableConfig(table);
      const rows = await db<
        { column_name: string; data_type: string; is_nullable: string }[]
      >`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${config.name}
      `;
      expect(rows.length).toBeGreaterThan(0);

      const actual = new Map(rows.map((row) => [row.column_name, row]));
      expect([...actual.keys()].sort()).toEqual(config.columns.map((column) => column.name).sort());

      for (const column of config.columns) {
        const found = actual.get(column.name);
        expect(found?.data_type).toBe(expectedType(column));
        // Primary keys are implicitly NOT NULL.
        const nullable = !(column.notNull || column.primary);
        expect(found?.is_nullable).toBe(nullable ? "YES" : "NO");
      }
    },
  );

  it("creates the indexes Better Auth's lookups rely on", async () => {
    const rows = await db<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'oauth\_%'
    `;
    const names = new Set(rows.map((row) => row.indexname));
    for (const name of [
      "oauth_client_client_id_key",
      "oauth_consent_user_id_idx",
      "oauth_refresh_token_user_id_idx",
      "oauth_access_token_refresh_id_idx",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("cascades OAuth rows when a user is deleted", async () => {
    const userId = randomUUID();
    await db`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'OAuth User', ${`oauth-${userId}@example.com`})`;
    const clientId = `https://client.example/${userId}`;
    await db`INSERT INTO oauth_client (client_id, redirect_uris) VALUES (${clientId}, ARRAY['http://localhost:9999/cb'])`;
    await db`
      INSERT INTO oauth_consent (client_id, user_id, reference_id, scopes, created_at, updated_at)
      VALUES (${clientId}, ${userId}, ${randomUUID()}, ARRAY['mcp:read'], now(), now())
    `;
    await db`DELETE FROM "user" WHERE id = ${userId}`;
    const [{ count }] = await db<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM oauth_consent WHERE client_id = ${clientId}
    `;
    expect(count).toBe(0);
  });
});
