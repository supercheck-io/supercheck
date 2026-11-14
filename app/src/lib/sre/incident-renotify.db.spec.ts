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
// No Redis: the per-org reminder cap fails open.
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => { throw new Error("no redis"); }), queueLogger: { error: jest.fn(), warn: jest.fn() } }));
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

it("gives the reminder back when every send failed, so a later tick retries it", async () => {
  await client`UPDATE sre_incidents SET renotified_at = NULL WHERE id = ${ids.due}`;
  notifyIncidentEvent.mockClear().mockResolvedValueOnce(false);
  expect(await renotifyUnacknowledgedIncidents()).toBe(1);
  const [row] = await client`SELECT renotified_at FROM sre_incidents WHERE id = ${ids.due}`;
  expect(row.renotified_at).toBeNull();
  // It waits out its 2-minute backoff, then goes again.
  expect(await renotifyUnacknowledgedIncidents()).toBe(0);
  expect(await renotifyUnacknowledgedIncidents(new Date(Date.now() + 3 * 60_000))).toBe(1);
  await client`UPDATE sre_incidents SET renotified_at = NULL, renotify_failures = 0, renotify_retry_at = NULL WHERE id = ${ids.due}`;
  notifyIncidentEvent.mockClear();
});

it("re-notifies only unacknowledged, open, recent incidents past their policy time, once", async () => {
  expect(await renotifyUnacknowledgedIncidents()).toBe(1);
  expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
  expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ incidentId: ids.due, projectId: policyProject, event: "unacknowledged" }));
  // A second tick finds nothing new: the first claimed it.
  expect(await renotifyUnacknowledgedIncidents()).toBe(0);
  expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
});

it("gives the claim back when a send throws, and keeps going with the rest", async () => {
  await client`UPDATE sre_incidents SET renotified_at = NULL WHERE id = ${ids.due}`;
  const extra = randomUUID();
  await incident(7, extra, policyProject, 46);
  notifyIncidentEvent.mockClear().mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce(true);
  expect(await renotifyUnacknowledgedIncidents()).toBe(2);
  const rows = await client`SELECT id, renotified_at FROM sre_incidents WHERE id IN (${ids.due}, ${extra})`;
  // Oldest first: the thrown send is released for the next tick, the other stays claimed.
  expect(rows.find((r) => r.id === extra)?.renotified_at).toBeNull();
  expect(rows.find((r) => r.id === ids.due)?.renotified_at).not.toBeNull();
  await client`DELETE FROM sre_incidents WHERE id = ${extra}`;
  notifyIncidentEvent.mockReset().mockResolvedValue(undefined);
});

it("sends at most 50 reminders per tick, in batches", async () => {
  await client`UPDATE sre_incidents SET renotified_at = now() WHERE project_id = ${policyProject}`;
  const batch: string[] = [];
  for (let i = 0; i < 60; i++) {
    const id = randomUUID();
    batch.push(id);
    await incident(100 + i, id, policyProject, 40);
  }
  notifyIncidentEvent.mockClear();
  // Recorded inside the mock: an expect there would be swallowed by the send try/catch.
  let claimedBeforeFirstSend = Infinity;
  notifyIncidentEvent.mockImplementationOnce(async () => {
    const [row] = await client`SELECT count(*)::int AS n FROM sre_incidents WHERE id = ANY(${batch}::uuid[]) AND renotified_at IS NOT NULL`;
    claimedBeforeFirstSend = row.n;
  });
  expect(await renotifyUnacknowledgedIncidents()).toBe(50);
  expect(claimedBeforeFirstSend).toBeLessThanOrEqual(10);
  expect(notifyIncidentEvent).toHaveBeenCalledTimes(50);
  expect(await renotifyUnacknowledgedIncidents()).toBe(10);
});

it("counts a reopened incident's wait from its reopen, not from its creation", async () => {
  await client`UPDATE sre_incidents SET renotified_at = now() WHERE project_id = ${policyProject}`;
  const [reopenedLong, reopenedJustNow] = [randomUUID(), randomUUID()];
  // Both were created 5 days ago (past the age cap) and reopened since.
  await incident(300, reopenedLong, policyProject, 5 * 24 * 60);
  await incident(301, reopenedJustNow, policyProject, 5 * 24 * 60);
  await client`UPDATE sre_incidents SET reopened_at = ${minutesAgo(45)} WHERE id = ${reopenedLong}`;
  await client`UPDATE sre_incidents SET reopened_at = ${minutesAgo(5)} WHERE id = ${reopenedJustNow}`;
  notifyIncidentEvent.mockReset().mockResolvedValue(undefined);
  expect(await renotifyUnacknowledgedIncidents()).toBe(1);
  expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ incidentId: reopenedLong }));
});
