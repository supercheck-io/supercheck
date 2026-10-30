/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `incident_alert_snapshot_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const migration = readFileSync(join(__dirname, "0046_incident_alert_snapshot.sql"), "utf8");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`CREATE TABLE sre_incident_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("adds nullable snapshot columns and is safe to apply twice", async () => {
  await client.unsafe(migration);
  await client.unsafe(migration);

  // Rows linked by an older app keep working without the snapshot.
  const [row] = await client`INSERT INTO sre_incident_alerts DEFAULT VALUES RETURNING alert_title, alert_description, alert_severity, alert_fired_at`;
  expect(row).toEqual({ alert_title: null, alert_description: null, alert_severity: null, alert_fired_at: null });

  const columns = await client`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'sre_incident_alerts' AND column_name LIKE 'alert_%' ORDER BY column_name`;
  expect(columns.map((c) => [c.column_name, c.is_nullable])).toEqual([
    ["alert_description", "YES"],
    ["alert_fired_at", "YES"],
    ["alert_severity", "YES"],
    ["alert_title", "YES"],
  ]);
});
