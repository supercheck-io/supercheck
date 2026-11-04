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
const notifyIncidentEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: (...a: unknown[]) => notifyIncidentEvent(...a) }));

import { renotifyUnacknowledgedIncidents } from "./incident-renotify";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `renotify_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const org = randomUUID();
const policyProject = randomUUID();
const plainProject = randomUUID();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ids = { due: randomUUID(), young: randomUUID(), acked: randomUUID(), resolved: randomUUID(), noPolicy: randomUUID(), ancient: randomUUID() };

async function incident(number: number, id: string, project: string, createdMinutesAgo: number, extra: { ack?: boolean; status?: string } = {}) {
  await client`INSERT INTO sre_incidents (incident_number, id, organization_id, project_id, title, severity, status, acknowledged_at, created_at)
    VALUES (${number}, ${id}, ${org}, ${project}, 't', 'sev2', ${extra.status ?? "triggered"}, ${extra.ack ? minutesAgo(1) : null}, ${minutesAgo(createdMinutesAgo)})`;
}

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
  client = postgres(url.toString(), { max: 2, onnotice: () => {} });
  mockDatabase = drizzle(client);
  await client.unsafe("SET session_replication_role = replica");
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${org}, 'o', ${org}, ${new Date().toISOString()})`;
  for (const project of [policyProject, plainProject]) {
    await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${project}, ${org}, 'p', ${project})`;
  }
  await client`INSERT INTO notification_policies (organization_id, project_id, renotify_unacked_minutes) VALUES (${org}, ${policyProject}, 30)`;
  await incident(1, ids.due, policyProject, 45);
  await incident(2, ids.young, policyProject, 5);
  await incident(3, ids.acked, policyProject, 45, { ack: true });
  await incident(4, ids.resolved, policyProject, 45, { status: "resolved" });
  await incident(5, ids.noPolicy, plainProject, 45);
  await incident(6, ids.ancient, policyProject, 5 * 24 * 60);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("re-notifies only unacknowledged, open, recent incidents past their policy time, once", async () => {
  expect(await renotifyUnacknowledgedIncidents()).toBe(1);
  expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
  expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ incidentId: ids.due, projectId: policyProject, event: "unacknowledged" }));
  // A second tick finds nothing new: the first claimed it.
  expect(await renotifyUnacknowledgedIncidents()).toBe(0);
  expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
});
