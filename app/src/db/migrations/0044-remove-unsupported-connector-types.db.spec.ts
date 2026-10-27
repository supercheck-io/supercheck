/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const databaseName = `remove_connectors_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const migration = readFileSync(join(__dirname, "0044_remove_unsupported_connector_types.sql"), "utf8");

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 1 });
  await client.unsafe(`
    CREATE TABLE external_connectors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type varchar(50) NOT NULL);
    CREATE TABLE sre_integration_bindings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      external_connector_id uuid NOT NULL REFERENCES external_connectors(id) ON DELETE CASCADE
    );
    CREATE TABLE sre_investigation_tool_calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connector_id uuid REFERENCES external_connectors(id) ON DELETE SET NULL,
      connector_type varchar(50) NOT NULL
    );
  `);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("deletes unsupported connectors, keeps supported ones and tool-call history", async () => {
  const [{ id: slack }] = await client`INSERT INTO external_connectors (type) VALUES ('slack') RETURNING id`;
  const [{ id: appdynamics }] = await client`INSERT INTO external_connectors (type) VALUES ('appdynamics') RETURNING id`;
  const [{ id: github }] = await client`INSERT INTO external_connectors (type) VALUES ('github') RETURNING id`;
  await client`INSERT INTO sre_integration_bindings (external_connector_id) VALUES (${slack}), (${github})`;
  await client`INSERT INTO sre_investigation_tool_calls (connector_id, connector_type) VALUES (${appdynamics}, 'appdynamics')`;

  await client.unsafe(migration);
  await client.unsafe(migration);

  const connectors = await client`SELECT type FROM external_connectors`;
  expect(connectors.map((row) => row.type)).toEqual(["github"]);
  const bindings = await client`SELECT external_connector_id FROM sre_integration_bindings`;
  expect(bindings.map((row) => row.external_connector_id)).toEqual([github]);
  const [toolCall] = await client`SELECT connector_id, connector_type FROM sre_investigation_tool_calls`;
  expect(toolCall).toMatchObject({ connector_id: null, connector_type: "appdynamics" });
});
