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
// No Redis: the per-org cap fails open (covered with Redis in incident-renotify.spec.ts).
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => { throw new Error("no redis"); }), queueLogger: { error: jest.fn(), warn: jest.fn() } }));
const notifyIncidentEvent = jest.fn();
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: (...a: unknown[]) => notifyIncidentEvent(...a) }));
// Stored configs here are plain JSON; the real envelope decryption is covered in crypto.spec.ts.
jest.mock("@/lib/notification-providers/crypto", () => ({ decryptNotificationProviderConfig: (config: unknown) => config }));
// Lets a test hold chosen incidents; everything else uses the real maintenance query.
const mockHeldIds = new Set<string>();
jest.mock("./incident-maintenance", () => {
  const actual = jest.requireActual("./incident-maintenance");
  return { incidentHeldForMaintenance: (id: string, at: Date) => (mockHeldIds.has(id) ? Promise.resolve(true) : actual.incidentHeldForMaintenance(id, at)) };
});
const isAssignableUser = jest.fn();
jest.mock("./incident-lifecycle", () => ({ isAssignableUser: (...a: unknown[]) => isAssignableUser(...a) }));

import { renotifyUnacknowledgedIncidents, resetHeldIncidentsForTest } from "./incident-renotify";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `renotify_sched_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
const org = randomUUID();
const project = randomUUID();
const otherOrg = randomUUID();
const otherProject = randomUUID();
const T0 = new Date(Date.now() - 24 * 60 * 60_000);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let number = 1;

async function incident(options: { project?: string; org?: string; openedAt?: Date; reminded?: { count: number; at: Date | null } } = {}) {
  const id = randomUUID();
  await client`INSERT INTO sre_incidents (incident_number, id, organization_id, project_id, title, severity, status, created_at, renotify_count, renotified_at)
    VALUES (${number++}, ${id}, ${options.org ?? org}, ${options.project ?? project}, 't', 'sev2', 'triggered', ${(options.openedAt ?? T0).toISOString()},
      ${options.reminded?.count ?? 0}, ${options.reminded?.at?.toISOString() ?? null})`;
  return id;
}

async function policy(values: { first?: number | null; repeat?: number | null; max?: number; escalate?: number | null; channel?: string | null; user?: string | null }, target = project, targetOrg = org) {
  await client`DELETE FROM notification_policies WHERE project_id = ${target}`;
  await client`INSERT INTO notification_policies (organization_id, project_id, renotify_unacked_minutes, renotify_repeat_minutes, renotify_max, escalate_after_minutes, escalate_channel_id, escalate_user_id)
    VALUES (${targetOrg}, ${target}, ${values.first ?? null}, ${values.repeat ?? null}, ${values.max ?? 3}, ${values.escalate ?? null}, ${values.channel ?? null}, ${values.user ?? null})`;
}

const row = async (id: string) => (await client`SELECT renotify_count, renotified_at, escalated_at, renotify_stopped_at FROM sre_incidents WHERE id = ${id}`)[0];
const sends = (event: string) => notifyIncidentEvent.mock.calls.filter(([input]) => (input as { event: string }).event === event);

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
  // Fixtures skip foreign keys; set per connection, since the pool (two concurrent ticks) uses several.
  client = postgres(url.toString(), { max: 4, onnotice: () => {}, connection: { session_replication_role: "replica" } });
  mockDatabase = drizzle(client);
  for (const [o, p] of [[org, project], [otherOrg, otherProject]]) {
    await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${o}, 'o', ${o}, ${new Date().toISOString()})`;
    await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${p}, ${o}, 'p', ${p})`;
  }
});

beforeEach(async () => {
  await client`DELETE FROM sre_incident_timeline_events`;
  await client`DELETE FROM sre_incidents`;
  await client`DELETE FROM notification_providers`;
  await client`UPDATE organization SET deletion_requested_at = NULL`;
  mockHeldIds.clear();
  resetHeldIncidentsForTest();
  notifyIncidentEvent.mockReset().mockResolvedValue(true);
  isAssignableUser.mockReset().mockResolvedValue(true);
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("A1: with N=15, M=60, K=3 reminds at 15, 75 and 135 minutes, then stops", async () => {
  await policy({ first: 15, repeat: 60, max: 3 });
  const id = await incident();
  const tick = async (minute: number) => renotifyUnacknowledgedIncidents(at(minute));
  expect(await tick(14)).toBe(0);
  expect(await tick(15)).toBe(1);
  expect(await tick(16)).toBe(0);
  expect(await tick(74)).toBe(0);
  expect(await tick(75)).toBe(1);
  expect(await tick(135)).toBe(1);
  expect(await tick(400)).toBe(0);
  expect((await row(id)).renotify_count).toBe(3);
  // Each reminder has its own number and dedupe window.
  expect(sends("unacknowledged").map(([input]) => (input as { reminder: unknown; dedupeDiscriminator: string }))).toEqual([
    expect.objectContaining({ reminder: { n: 1, of: 3 }, dedupeDiscriminator: "renotify:0:1" }),
    expect.objectContaining({ reminder: { n: 2, of: 3 }, dedupeDiscriminator: "renotify:0:2" }),
    expect.objectContaining({ reminder: { n: 3, of: 3 }, dedupeDiscriminator: "renotify:0:3" }),
  ]);
});

it("A1: an incident reminded before the migration (backfilled count 1) or claimed by an old replica is not reminded twice", async () => {
  await policy({ first: 15, repeat: null });
  const backfilled = await incident({ reminded: { count: 1, at: at(15) } });
  // An old replica sets renotified_at only.
  const oldReplica = await incident({ reminded: { count: 0, at: at(15) } });
  expect(await renotifyUnacknowledgedIncidents(at(200))).toBe(0);
  expect((await row(backfilled)).renotify_count).toBe(1);
  expect((await row(oldReplica)).renotify_count).toBe(0);
});

it("A2: without a repeat interval it reminds exactly once", async () => {
  await policy({ first: 15, repeat: null, max: 5 });
  const id = await incident();
  expect(await renotifyUnacknowledgedIncidents(at(15))).toBe(1);
  expect(await renotifyUnacknowledgedIncidents(at(300))).toBe(0);
  expect((await row(id)).renotify_count).toBe(1);
  // Labelled "1 of 1", not the stored default max.
  expect(sends("unacknowledged")[0][0]).toEqual(expect.objectContaining({ reminder: { n: 1, of: 1 } }));
});

it("rollout: an incident reopened by an older replica (count kept, renotified_at cleared) is reminded again from 1", async () => {
  await policy({ first: 15, repeat: 60, max: 3 });
  const id = await incident({ reminded: { count: 3, at: null } });
  expect(await renotifyUnacknowledgedIncidents(at(15))).toBe(1);
  expect((await row(id)).renotify_count).toBe(1);
  expect(await renotifyUnacknowledgedIncidents(at(75))).toBe(1);
  expect((await row(id)).renotify_count).toBe(2);
});

it("rollout: a first reminder sent by an older replica (no count) still gets its repeats", async () => {
  await policy({ first: 15, repeat: 60, max: 3 });
  const id = await incident({ reminded: { count: 0, at: at(15) } });
  expect(await renotifyUnacknowledgedIncidents(at(75))).toBe(1);
  expect((await row(id)).renotify_count).toBe(2);
});

it("held claims do not use the tick's budget: 60 held incidents cannot starve another org's reminder or an escalation", async () => {
  const otherChannel = randomUUID();
  await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, is_enabled) VALUES (${otherChannel}, ${otherOrg}, ${otherProject}, 'ops', 'slack', ${JSON.stringify({ webhookUrl: "https://hooks.slack.com/x" })}::jsonb, true)`;
  await policy({ first: 15 });
  await policy({ first: 15, escalate: 15, channel: otherChannel }, otherProject, otherOrg);
  for (let i = 0; i < 60; i++) mockHeldIds.add(await incident({ openedAt: at(-60) }));
  const other = await incident({ org: otherOrg, project: otherProject });
  expect(await renotifyUnacknowledgedIncidents(at(30))).toBe(2);
  expect(sends("unacknowledged").map(([input]) => (input as { incidentId: string }).incidentId)).toEqual([other]);
  expect(sends("escalated")).toEqual([[expect.objectContaining({ incidentId: other })]]);
});

it("A3: acknowledge, resolve and a lowered severity stop further reminders", async () => {
  await policy({ first: 15, repeat: 60, max: 3 });
  const [acked, resolved, stopped] = [await incident(), await incident(), await incident()];
  expect(await renotifyUnacknowledgedIncidents(at(15))).toBe(3);
  await client`UPDATE sre_incidents SET acknowledged_at = ${at(20).toISOString()} WHERE id = ${acked}`;
  await client`UPDATE sre_incidents SET status = 'resolved' WHERE id = ${resolved}`;
  await client`UPDATE sre_incidents SET renotify_stopped_at = ${at(20).toISOString()} WHERE id = ${stopped}`;
  expect(await renotifyUnacknowledgedIncidents(at(75))).toBe(0);
});

it("A5: two concurrent ticks claim each reminder once", async () => {
  await policy({ first: 15 });
  const created = await Promise.all(Array.from({ length: 8 }, () => incident()));
  notifyIncidentEvent.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  });
  const [a, b] = await Promise.all([renotifyUnacknowledgedIncidents(at(20)), renotifyUnacknowledgedIncidents(at(20))]);
  expect(a + b).toBe(8);
  const ids = sends("unacknowledged").map(([input]) => (input as { incidentId: string }).incidentId);
  expect(new Set(ids).size).toBe(8);
  expect(ids).toHaveLength(8);
  expect(created.every((id) => ids.includes(id))).toBe(true);
});

it("A6: a failed send gives the reminder back to its previous count and time", async () => {
  await policy({ first: 15, repeat: 60, max: 3 });
  const id = await incident();
  await renotifyUnacknowledgedIncidents(at(15));
  const before = await row(id);
  notifyIncidentEvent.mockResolvedValueOnce(false);
  const stats = { failed: 0 };
  expect(await renotifyUnacknowledgedIncidents(at(75), stats)).toBe(1);
  expect(stats.failed).toBe(1);
  const after = await row(id);
  expect(after.renotify_count).toBe(1);
  expect(new Date(after.renotified_at).getTime()).toBe(new Date(before.renotified_at).getTime());
  // Not before its 2-minute backoff, then retried.
  expect(await renotifyUnacknowledgedIncidents(at(76))).toBe(0);
  expect(await renotifyUnacknowledgedIncidents(at(77))).toBe(1);
  expect((await row(id)).renotify_count).toBe(2);
});

it("A6: a reopen during the send is not overwritten by the release", async () => {
  await policy({ first: 15 });
  const id = await incident();
  notifyIncidentEvent.mockImplementationOnce(async () => {
    await client`UPDATE sre_incidents SET renotify_count = 0, renotified_at = NULL, reopened_at = ${at(18).toISOString()} WHERE id = ${id}`;
    return false;
  });
  await renotifyUnacknowledgedIncidents(at(20));
  const after = await row(id);
  expect(after.renotify_count).toBe(0);
  expect(after.renotified_at).toBeNull();
});

it("skips incidents of organizations pending deletion", async () => {
  await policy({ first: 15, escalate: 15, user: randomUUID() });
  await incident();
  await client`UPDATE organization SET deletion_requested_at = now() WHERE id = ${org}`;
  expect(await renotifyUnacknowledgedIncidents(at(60))).toBe(0);
  expect(notifyIncidentEvent).not.toHaveBeenCalled();
});

it("A7: a scheduled maintenance holds the send without using a reminder", async () => {
  await policy({ first: 15 });
  const id = await incident();
  const [monitor, component, statusPage, maintenanceId, alertEvent] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await client`INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, source_type, source_id, title, fired_at)
    VALUES (${alertEvent}, ${org}, ${project}, ${randomUUID().replaceAll("-", "")}, 'monitor', ${monitor}, 'down', ${T0.toISOString()})`;
  // Ids come from the app (uuidv7 in drizzle), so these tables have no database default.
  await client`INSERT INTO sre_incident_alerts (id, incident_id, alert_event_id, role, alert_title, alert_severity, alert_fired_at)
    VALUES (${randomUUID()}, ${id}, ${alertEvent}, 'trigger', 'down', 'sev2', ${T0.toISOString()})`;
  await client`INSERT INTO status_page_component_monitors (component_id, monitor_id) VALUES (${component}, ${monitor})`;
  await client`INSERT INTO incidents (id, status_page_id, name, status, impact, scheduled_for, scheduled_until)
    VALUES (${maintenanceId}, ${statusPage}, 'm', 'scheduled', 'none', ${at(0).toISOString()}, ${at(60).toISOString()})`;
  await client`INSERT INTO incident_components (id, incident_id, component_id, old_status, new_status) VALUES (${randomUUID()}, ${maintenanceId}, ${component}, 'operational', 'under_maintenance')`;

  // Held: nothing sent, nothing counted, no reminder used.
  expect(await renotifyUnacknowledgedIncidents(at(20))).toBe(0);
  expect(notifyIncidentEvent).not.toHaveBeenCalled();
  expect((await row(id)).renotify_count).toBe(0);
  // After the window the reminder goes out.
  expect(await renotifyUnacknowledgedIncidents(at(61))).toBe(1);
  expect(sends("unacknowledged")).toHaveLength(1);
  expect((await row(id)).renotify_count).toBe(1);
});

describe("A9: escalation", () => {
  it("escalates once to the channel after E minutes and stops on acknowledge", async () => {
    const channel = randomUUID();
    await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, is_enabled) VALUES (${channel}, ${org}, ${project}, 'ops', 'slack', ${JSON.stringify({ webhookUrl: "https://hooks.slack.com/x" })}::jsonb, true)`;
    await policy({ escalate: 30, channel });
    const [id, acked] = [await incident(), await incident()];
    await client`UPDATE sre_incidents SET acknowledged_at = ${at(5).toISOString()} WHERE id = ${acked}`;
    expect(await renotifyUnacknowledgedIncidents(at(29))).toBe(0);
    expect(await renotifyUnacknowledgedIncidents(at(30))).toBe(1);
    expect(sends("escalated")).toEqual([[expect.objectContaining({ incidentId: id, targets: { providerIds: [channel] } })]]);
    expect(await renotifyUnacknowledgedIncidents(at(120))).toBe(0);
    expect((await row(acked)).escalated_at).toBeNull();
  });

  it("emails a member target, re-checked at send time; a removed member is terminal and noted once", async () => {
    const member = randomUUID();
    await policy({ escalate: 30, user: member });
    const [kept, removed] = [await incident(), await incident()];
    isAssignableUser.mockImplementation(async () => true);
    await renotifyUnacknowledgedIncidents(at(30));
    expect(sends("escalated")).toHaveLength(2);
    expect(sends("escalated")[0][0]).toEqual(expect.objectContaining({ targets: { userIds: [member] } }));

    notifyIncidentEvent.mockClear();
    const late = await incident({ openedAt: at(10) });
    isAssignableUser.mockResolvedValue(false);
    // A removed target is terminal: noted, not sent, so no send attempt is counted.
    expect(await renotifyUnacknowledgedIncidents(at(41))).toBe(0);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    const events = await client`SELECT event_data FROM sre_incident_timeline_events WHERE incident_id = ${late}`;
    expect(events).toEqual([{ event_data: expect.objectContaining({ kind: "escalation", reached: 0 }) }]);
    expect((await row(late)).escalated_at).not.toBeNull();
    expect(await renotifyUnacknowledgedIncidents(at(90))).toBe(0);
    expect([kept, removed]).toHaveLength(2);
  });

  it("does not escalate to a deleted channel, a paging preset, or a channel of another project", async () => {
    const preset = randomUUID();
    const foreign = randomUUID();
    await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, is_enabled) VALUES (${preset}, ${org}, ${project}, 'pd', 'webhook', ${JSON.stringify({ url: "https://events.pagerduty.com/v2/enqueue", preset: "pagerduty" })}::jsonb, true)`;
    await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, is_enabled) VALUES (${foreign}, ${otherOrg}, ${otherProject}, 'x', 'slack', ${JSON.stringify({ webhookUrl: "https://hooks.slack.com/x" })}::jsonb, true)`;
    for (const target of [preset, foreign, null]) {
      await client`DELETE FROM sre_incident_timeline_events`;
      await client`DELETE FROM sre_incidents`;
      await policy({ escalate: 30, channel: target });
      const id = await incident();
      expect(await renotifyUnacknowledgedIncidents(at(30))).toBe(0);
      expect(notifyIncidentEvent).not.toHaveBeenCalled();
      const events = await client`SELECT event_data FROM sre_incident_timeline_events WHERE incident_id = ${id}`;
      expect(events).toEqual([{ event_data: expect.objectContaining({ kind: "escalation", reached: 0 }) }]);
    }
  });

  it("a transient send failure releases the escalation for a later tick", async () => {
    const channel = randomUUID();
    await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config, is_enabled) VALUES (${channel}, ${org}, ${project}, 'ops', 'slack', ${JSON.stringify({ webhookUrl: "https://hooks.slack.com/x" })}::jsonb, true)`;
    await policy({ escalate: 30, channel });
    const id = await incident();
    notifyIncidentEvent.mockResolvedValueOnce(false);
    await renotifyUnacknowledgedIncidents(at(30));
    expect((await row(id)).escalated_at).toBeNull();
    // Waits out the 2-minute backoff.
    await renotifyUnacknowledgedIncidents(at(31));
    expect((await row(id)).escalated_at).toBeNull();
    await renotifyUnacknowledgedIncidents(at(32));
    expect((await row(id)).escalated_at).not.toBeNull();
    expect(sends("escalated")).toHaveLength(2);
  });
});
