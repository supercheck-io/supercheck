/** @jest-environment node */
const incr = jest.fn();
const get = jest.fn();
const expire = jest.fn();
const getRedisConnection = jest.fn();
jest.mock("@/lib/queue", () => ({ getRedisConnection: () => getRedisConnection(), queueLogger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn() }));
const mockHeld = jest.fn();
jest.mock("@/lib/sre/incident-maintenance", () => ({ incidentHeldForMaintenance: (...a: unknown[]) => mockHeld(...a) }));
const mockAssignable = jest.fn();
jest.mock("./incident-lifecycle", () => ({ isAssignableUser: (...a: unknown[]) => mockAssignable(...a) }));
jest.mock("@/lib/notification-providers/crypto", () => ({
  decryptNotificationProviderConfig: (config: { broken?: boolean }) => {
    if (config.broken) throw new Error("bad envelope");
    return config;
  },
}));
jest.mock("@/sre/lib/incident-sweep", () => ({ sweepSreIncidents: jest.fn() }));

import { ORG_SENDS_PER_HOUR, allowOrgIncidentSend, recordOrgIncidentSend, renotifyUnacknowledgedIncidents, resetHeldIncidentsForTest } from "./incident-renotify";

const counts = new Map<string, number>();
beforeEach(() => {
  counts.clear();
  incr.mockReset().mockImplementation(async (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts.get(key);
  });
  get.mockReset().mockImplementation(async (key: string) => (counts.has(key) ? String(counts.get(key)) : null));
  expire.mockReset().mockResolvedValue(1);
  getRedisConnection.mockReset().mockResolvedValue({ incr, expire, get });
});

it("A8: allows 30 delivered sends per organization per hour, then holds; another org is unaffected", async () => {
  const now = new Date("2026-11-14T10:15:00Z");
  for (let i = 0; i < ORG_SENDS_PER_HOUR; i++) {
    expect(await allowOrgIncidentSend("org-a", now)).toBe(true);
    await recordOrgIncidentSend("org-a", now);
  }
  expect(await allowOrgIncidentSend("org-a", now)).toBe(false);
  expect(await allowOrgIncidentSend("org-b", now)).toBe(true);
  // The key expires after two hours; it is set once, on the first send of the hour.
  expect(expire.mock.calls.filter(([key]) => String(key).includes("org-a"))).toEqual([[expect.any(String), 7200]]);
  // A new hour starts a new count.
  expect(await allowOrgIncidentSend("org-a", new Date("2026-11-14T11:00:00Z"))).toBe(true);
});

it("A8: checking the cap does not use it up (only delivered sends count)", async () => {
  const now = new Date("2026-11-14T10:15:00Z");
  for (let i = 0; i < 100; i++) await allowOrgIncidentSend("org-a", now);
  expect(await allowOrgIncidentSend("org-a", now)).toBe(true);
  expect(incr).not.toHaveBeenCalled();
});

it("A8: sends when Redis is unavailable", async () => {
  getRedisConnection.mockRejectedValue(new Error("down"));
  expect(await allowOrgIncidentSend("org-a")).toBe(true);
  await expect(recordOrgIncidentSend("org-a")).resolves.toBeUndefined();
});

describe("renotifyUnacknowledgedIncidents branching (SQL is covered by the .db specs)", () => {
  const { db } = jest.requireMock("@/utils/db") as { db: Record<string, unknown> };
  const { notifyIncidentEvent } = jest.requireMock("@/lib/sre/incident-notifier") as { notifyIncidentEvent: jest.Mock };
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
  // Claims are told apart by their SQL, so the order of the two loops does not matter to the tests.
  const reminderClaims: unknown[][] = [];
  const escalationClaims: unknown[][] = [];
  const claimSql: string[] = [];
  const claimParams: unknown[][] = [];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let channelRows: unknown[] = [];
  const reminder = (over: Record<string, unknown> = {}) => ({ id: "i1", organization_id: "org-a", project_id: "p1", created_at: new Date("2026-11-14T08:00:00Z"), reopened_at: null, renotify_count: 2, prev_count: 1, prev_at: new Date("2026-11-14T08:15:00Z"), failures: 0, max: 3, ...over });
  const escalation = (over: Record<string, unknown> = {}) => ({ id: "e1", organization_id: "org-a", project_id: "p1", escalate_channel_id: "c1", escalate_user_id: null, failures: 0, ...over });
  const now = new Date("2026-11-14T10:00:00Z");

  beforeEach(() => {
    reminderClaims.length = 0;
    escalationClaims.length = 0;
    claimSql.length = 0;
    claimParams.length = 0;
    updates.length = 0;
    inserts.length = 0;
    channelRows = [{ type: "slack", config: {}, projectId: "p1" }];
    db.execute = jest.fn(async (query: unknown) => {
      const { sql: text, params } = new PgDialect().sqlToQuery(query);
      claimSql.push(text);
      claimParams.push(params);
      return (text.includes("SET escalated_at") ? escalationClaims : reminderClaims).shift() ?? [];
    });
    db.update = jest.fn(() => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => undefined }; } }));
    db.insert = jest.fn(() => ({ values: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve(); } }));
    db.select = jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => channelRows }) }) }));
    notifyIncidentEvent.mockReset().mockResolvedValue(true);
    mockHeld.mockReset().mockResolvedValue(false);
    resetHeldIncidentsForTest();
  });

  it("claims escalations before reminders", async () => {
    await renotifyUnacknowledgedIncidents(now);
    expect(claimSql[0]).toContain("SET escalated_at");
  });

  it("sends a claimed reminder with its number and per-reminder dedupe key, and counts it", async () => {
    reminderClaims.push([reminder()]);
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(1);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "unacknowledged", reminder: { n: 2, of: 3 }, dedupeDiscriminator: "renotify:0:2" }));
    expect(updates).toEqual([]);
    expect(incr).toHaveBeenCalledWith(expect.stringContaining("renotify:org:org-a"));
  });

  it("a failed reminder goes back with a 2-minute backoff and does not count against the cap", async () => {
    reminderClaims.push([reminder()]);
    notifyIncidentEvent.mockResolvedValueOnce(false);
    const stats = { failed: 0 };
    await renotifyUnacknowledgedIncidents(now, stats);
    expect(stats.failed).toBe(1);
    expect(updates).toEqual([{ renotifyCount: 1, renotifiedAt: new Date("2026-11-14T08:15:00Z"), renotifyFailures: 1, renotifyRetryAt: new Date(now.getTime() + 2 * 60_000) }]);
    expect(incr).not.toHaveBeenCalled();
  });

  it("backs off longer each time and gives up after 5 failures with a timeline note", async () => {
    reminderClaims.push([reminder({ failures: 3 })]);
    notifyIncidentEvent.mockResolvedValueOnce(false);
    await renotifyUnacknowledgedIncidents(now);
    expect(updates[0]).toMatchObject({ renotifyFailures: 4, renotifyRetryAt: new Date(now.getTime() + 16 * 60_000) });

    updates.length = 0;
    reminderClaims.push([reminder({ failures: 4 })]);
    notifyIncidentEvent.mockResolvedValueOnce(false);
    await renotifyUnacknowledgedIncidents(now);
    // Not released: the reminder stays used; failures are cleared for the next one.
    expect(updates).toEqual([{ renotifyFailures: 0, renotifyRetryAt: null }]);
    expect(inserts).toEqual([expect.objectContaining({ eventData: expect.objectContaining({ kind: "reminder", n: 2, failed: true, attempts: 5, reached: 0 }) })]);
  });

  it("a send skipped on purpose (acknowledged meanwhile) does not use the org cap", async () => {
    reminderClaims.push([reminder()]);
    notifyIncidentEvent.mockImplementationOnce(async (input: { report?: { skipped?: boolean } }) => {
      if (input.report) input.report.skipped = true;
      return true;
    });
    await renotifyUnacknowledgedIncidents(now);
    expect(incr).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("clears the failure count after a successful retry", async () => {
    reminderClaims.push([reminder({ failures: 2 })]);
    await renotifyUnacknowledgedIncidents(now);
    expect(updates).toEqual([{ renotifyFailures: 0, renotifyRetryAt: null }]);
  });

  it("releases without sending while held for maintenance or over the org cap, without touching failures", async () => {
    mockHeld.mockResolvedValueOnce(true);
    reminderClaims.push([reminder()]);
    await renotifyUnacknowledgedIncidents(now);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([{ renotifyCount: 1, renotifiedAt: expect.any(Date) }]);

    updates.length = 0;
    for (let i = 0; i < ORG_SENDS_PER_HOUR; i++) await recordOrgIncidentSend("org-a", now, "reminder");
    reminderClaims.push([reminder()]);
    escalationClaims.push([escalation()]);
    // Reminders are capped; escalations have their own budget and still go out.
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(1);
    expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "escalated" }));
    expect(updates).toEqual([{ renotifyCount: 1, renotifiedAt: expect.any(Date) }]);
  });

  it("skips incidents found held for maintenance in later ticks for a few minutes, then rechecks them", async () => {
    mockHeld.mockResolvedValueOnce(true);
    reminderClaims.push([reminder()]);
    await renotifyUnacknowledgedIncidents(now);
    claimParams.length = 0;
    await renotifyUnacknowledgedIncidents(new Date(now.getTime() + 60_000));
    expect(claimParams.every((params) => params.includes("i1"))).toBe(true);
    claimParams.length = 0;
    await renotifyUnacknowledgedIncidents(new Date(now.getTime() + 6 * 60_000));
    expect(claimParams.some((params) => params.includes("i1"))).toBe(false);
  });

  it("escalates to a usable channel and counts it on the escalation cap", async () => {
    escalationClaims.push([escalation()]);
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(1);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "escalated", targets: { providerIds: ["c1"] } }));
    expect(incr).toHaveBeenCalledWith(expect.stringContaining("escalate:org:org-a"));
  });

  it("escalates to a member who can act", async () => {
    mockAssignable.mockResolvedValueOnce(true);
    escalationClaims.push([escalation({ escalate_channel_id: null, escalate_user_id: "u1" })]);
    await renotifyUnacknowledgedIncidents(now);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ targets: { userIds: ["u1"] } }));
  });

  it.each([
    ["a deleted channel", () => { channelRows = []; }, escalation()],
    ["a paging preset", () => { channelRows = [{ type: "webhook", config: { preset: "pagerduty" }, projectId: "p1" }]; }, escalation()],
    ["an unreadable channel config", () => { channelRows = [{ type: "slack", config: { broken: true }, projectId: "p1" }]; }, escalation()],
    ["a removed member", () => { mockAssignable.mockResolvedValueOnce(false); }, escalation({ escalate_channel_id: null, escalate_user_id: "u1" })],
    ["no target at all", () => undefined, escalation({ escalate_channel_id: null })],
  ])("treats %s as terminal: noted once, not released", async (_name, arrange, row) => {
    arrange();
    escalationClaims.push([row]);
    await renotifyUnacknowledgedIncidents(now);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(inserts).toEqual([expect.objectContaining({ eventType: "notification", eventData: expect.objectContaining({ kind: "escalation", reached: 0 }) })]);
  });

  it("a failed escalation is retried with backoff and given up after 5 failures", async () => {
    escalationClaims.push([escalation()]);
    notifyIncidentEvent.mockRejectedValueOnce(new Error("down"));
    const stats = { failed: 0 };
    await renotifyUnacknowledgedIncidents(now, stats);
    expect(stats.failed).toBe(1);
    expect(updates).toEqual([{ escalatedAt: null, escalateFailures: 1, escalateRetryAt: new Date(now.getTime() + 2 * 60_000) }]);

    updates.length = 0;
    escalationClaims.push([escalation({ failures: 4 })]);
    notifyIncidentEvent.mockResolvedValueOnce(false);
    await renotifyUnacknowledgedIncidents(now);
    expect(updates).toEqual([{ escalateFailures: 0, escalateRetryAt: null }]);
    expect(inserts).toEqual([expect.objectContaining({ eventData: expect.objectContaining({ kind: "escalation", failed: true, attempts: 5 }) })]);
  });

  it("releases an escalation, without counting a failure, when the target lookup throws", async () => {
    db.select = jest.fn(() => { throw new Error("db down"); });
    escalationClaims.push([escalation()]);
    await renotifyUnacknowledgedIncidents(now);
    expect(updates).toEqual([{ escalatedAt: null }]);
  });
});
