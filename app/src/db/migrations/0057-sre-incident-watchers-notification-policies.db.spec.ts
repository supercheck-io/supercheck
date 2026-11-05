/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `incident_watchers_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const statements = readFileSync(join(__dirname, "0057_sre_incident_watchers_notification_policies.sql"), "utf8")
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
    CREATE TABLE sre_incidents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  `);
  await applyMigration();
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

describe("0057 incident watchers and notification policies", () => {
  it("is safe to apply twice", async () => {
    await expect(applyMigration()).resolves.toBeUndefined();
  });

  it("keeps one watcher row per incident and user, and cascades with either side", async () => {
    const [incident] = await client`INSERT INTO sre_incidents DEFAULT VALUES RETURNING id`;
    const [person] = await client`INSERT INTO "user" DEFAULT VALUES RETURNING id`;
    await client`INSERT INTO sre_incident_watchers (incident_id, user_id) VALUES (${incident.id}, ${person.id})`;
    await expect(
      client`INSERT INTO sre_incident_watchers (incident_id, user_id) VALUES (${incident.id}, ${person.id})`,
    ).rejects.toThrow(/unique/i);
    await client`DELETE FROM "user" WHERE id = ${person.id}`;
    expect(await client`SELECT 1 FROM sre_incident_watchers`).toHaveLength(0);

    const [other] = await client`INSERT INTO "user" DEFAULT VALUES RETURNING id`;
    await client`INSERT INTO sre_incident_watchers (incident_id, user_id) VALUES (${incident.id}, ${other.id})`;
    await client`DELETE FROM sre_incidents WHERE id = ${incident.id}`;
    expect(await client`SELECT 1 FROM sre_incident_watchers`).toHaveLength(0);
  });

  it("allows one policy per project with every option off by default", async () => {
    const [org] = await client`INSERT INTO organization DEFAULT VALUES RETURNING id`;
    const [project] = await client`INSERT INTO projects DEFAULT VALUES RETURNING id`;
    const [policy] = await client`INSERT INTO notification_policies (organization_id, project_id) VALUES (${org.id}, ${project.id}) RETURNING *`;
    expect(policy).toMatchObject({
      channel_ids: [],
      email_service_owners_on_sev12: false,
      renotify_unacked_minutes: null,
      auto_investigate_on_open: false,
    });
    await expect(
      client`INSERT INTO notification_policies (organization_id, project_id) VALUES (${org.id}, ${project.id})`,
    ).rejects.toThrow(/unique/i);
    await expect(client`UPDATE notification_policies SET renotify_unacked_minutes = 1`).rejects.toThrow(/check/i);
    await client`UPDATE notification_policies SET renotify_unacked_minutes = 30`;
    await client`DELETE FROM projects WHERE id = ${project.id}`;
    expect(await client`SELECT 1 FROM notification_policies`).toHaveLength(0);
  });
});
