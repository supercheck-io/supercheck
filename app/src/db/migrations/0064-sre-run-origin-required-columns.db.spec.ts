/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `sre_origin_cols_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const m0061 = read("0061_sre_run_origin.sql");
const m0064 = read("0064_sre_run_origin_required_columns.sql");

// Pre-0061 shape of the two tables (only the columns 0061 touches or indexes).
const baseTables = `
  DROP TABLE IF EXISTS sre_incidents, sre_investigation_runs;
  CREATE TABLE sre_incidents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE sre_investigation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid, project_id uuid, incident_id uuid, agent_type text, status text
  );
`;

// 0061 has CONCURRENTLY statements, so run statement by statement like scripts/db-migrate.js does.
const run = async (sql: string) => {
  for (const s of sql.split("--> statement-breakpoint")) {
    if (s.replace(/--[^\n]*/g, "").trim()) await client.unsafe(s.trim());
  }
};

const columns = async () =>
  (
    await client`SELECT column_name FROM information_schema.columns
      WHERE (table_name = 'sre_incidents' AND column_name = 'reopened_at')
         OR (table_name = 'sre_investigation_runs' AND column_name = 'origin')`
  )
    .map((r) => r.column_name)
    .sort();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("adds the columns and CHECK when the deferred 0061 never ran, and is idempotent", async () => {
  await client.unsafe(baseTables);
  expect(await columns()).toEqual([]);

  await run(m0064);
  await run(m0064);
  expect(await columns()).toEqual(["origin", "reopened_at"]);

  const [{ id }] = await client`INSERT INTO sre_investigation_runs DEFAULT VALUES RETURNING id`;
  const [row] = await client`SELECT origin FROM sre_investigation_runs WHERE id = ${id}`;
  expect(row.origin).toBe("manual");
  await expect(client`UPDATE sre_investigation_runs SET origin = 'bogus'`).rejects.toThrow(/origin_check/);
  const [con] = await client`SELECT convalidated FROM pg_constraint WHERE conname = 'sre_investigation_runs_origin_check'`;
  expect(con.convalidated).toBe(false);

  await run(m0061);
  const [after] = await client`SELECT convalidated FROM pg_constraint WHERE conname = 'sre_investigation_runs_origin_check'`;
  expect(after.convalidated).toBe(true);
});

it("is a no-op after 0061 succeeded, and 0061 still applies after 0064", async () => {
  await client.unsafe(baseTables);
  await run(m0061);
  await run(m0064);
  expect(await columns()).toEqual(["origin", "reopened_at"]);
  const [{ n }] = await client`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'sre_investigation_runs_origin_check'`;
  expect(n).toBe(1);

  await client.unsafe(baseTables);
  await run(m0064);
  await run(m0061);
  const [idx] = await client`SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'sre_investigation_runs_auto_incident_unique'`;
  expect(idx.ok).toBe(1);
});
