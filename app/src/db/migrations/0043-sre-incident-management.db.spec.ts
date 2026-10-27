/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `incident_mgmt_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const statements = readFileSync(join(__dirname, "0043_sre_incident_management.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

async function applyMigration() {
  for (const statement of statements) await client.unsafe(statement);
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`
    CREATE FUNCTION uuidv7() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
    CREATE TABLE "user" (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE organization (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE sre_incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status varchar(25) NOT NULL DEFAULT 'triggered',
      project_id uuid
    );
    CREATE TABLE sre_investigation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("applies cleanly and is safe to apply twice", async () => {
  await applyMigration();
  await applyMigration();
  const columns = await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'sre_incidents'`;
  expect(columns.map((row) => row.column_name)).toEqual(
    expect.arrayContaining(["assignee_user_id", "acknowledged_at", "acknowledged_by_user_id", "commander_user_id", "mitigated_at", "resolution_summary", "postmortem"]),
  );
  const runColumns = await client`SELECT column_name FROM information_schema.columns WHERE table_name = 'sre_investigation_runs'`;
  expect(runColumns.map((row) => row.column_name)).toEqual(expect.arrayContaining(["steps", "hypotheses"]));
});

it("nulls the assignee when the user is deleted", async () => {
  const [{ id: userId }] = await client`INSERT INTO "user" DEFAULT VALUES RETURNING id`;
  const [{ id: incidentId }] = await client`INSERT INTO sre_incidents (assignee_user_id) VALUES (${userId}) RETURNING id`;
  await client`DELETE FROM "user" WHERE id = ${userId}`;
  const [row] = await client`SELECT assignee_user_id FROM sre_incidents WHERE id = ${incidentId}`;
  expect(row.assignee_user_id).toBeNull();
});

it("bounds the resolution summary and restricts feedback verdict and note", async () => {
  await expect(client`INSERT INTO sre_incidents (resolution_summary) VALUES (${"x".repeat(4001)})`).rejects.toThrow();
  const [{ id: org }] = await client`INSERT INTO organization DEFAULT VALUES RETURNING id`;
  const [{ id: project }] = await client`INSERT INTO projects DEFAULT VALUES RETURNING id`;
  const [{ id: user }] = await client`INSERT INTO "user" DEFAULT VALUES RETURNING id`;
  const [{ id: incident }] = await client`INSERT INTO sre_incidents DEFAULT VALUES RETURNING id`;
  const [{ id: run }] = await client`INSERT INTO sre_investigation_runs DEFAULT VALUES RETURNING id`;
  const insert = (verdict: string, note: string | null) => client`
    INSERT INTO sre_investigation_feedback (organization_id, project_id, incident_id, investigation_run_id, user_id, verdict, note)
    VALUES (${org}, ${project}, ${incident}, ${run}, ${user}, ${verdict}, ${note})`;
  await expect(insert("right", "ok")).resolves.toBeDefined();
  await expect(insert("maybe", null)).rejects.toThrow();
  await expect(insert("wrong", "x".repeat(501))).rejects.toThrow();
});
