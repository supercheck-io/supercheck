/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(), queueLogger: { error: jest.fn() } }));

import { recordRepeatAlert } from "./incident-lifecycle";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `alert_count_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const org = randomUUID();
const project = randomUUID();
const open = randomUUID();
const resolved = randomUUID();

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client);
  await client.unsafe("SET session_replication_role = replica");
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, 'o', ${org}, ${new Date().toISOString()})`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project})`;
  await client`INSERT INTO sre_incidents (id, organization_id, project_id, incident_number, title, severity, status) VALUES (${open}, ${org}, ${project}, 1, 't', 'sev2', 'triggered')`;
  await client`INSERT INTO sre_incidents (id, organization_id, project_id, incident_number, title, severity, status) VALUES (${resolved}, ${org}, ${project}, 2, 't', 'sev2', 'resolved')`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("starts an incident at one alert", async () => {
  const [row] = await client`SELECT alert_count FROM sre_incidents WHERE id = ${open}`;
  expect(row.alert_count).toBe(1);
});

it("counts every concurrent repeat exactly once", async () => {
  const base = Date.now();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => recordRepeatAlert(mockDatabase as never, open, new Date(base + (i + 1) * 1000))),
  );
  expect(results.every(Boolean)).toBe(true);
  const [row] = await client`SELECT alert_count, last_alert_at FROM sre_incidents WHERE id = ${open}`;
  expect(row.alert_count).toBe(21);
  expect(row.last_alert_at).not.toBeNull();
});

it("does not count the same alert twice (a queue retry)", async () => {
  const at = new Date(Date.now() + 60_000);
  expect(await recordRepeatAlert(mockDatabase as never, open, at)).toBe(true);
  expect(await recordRepeatAlert(mockDatabase as never, open, at)).toBe(false);
  const [row] = await client`SELECT alert_count FROM sre_incidents WHERE id = ${open}`;
  expect(row.alert_count).toBe(22);
});

it("leaves a resolved incident alone", async () => {
  expect(await recordRepeatAlert(mockDatabase as never, resolved, new Date())).toBe(false);
  const [row] = await client`SELECT alert_count FROM sre_incidents WHERE id = ${resolved}`;
  expect(row.alert_count).toBe(1);
});
