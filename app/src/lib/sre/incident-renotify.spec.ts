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
  const executeQueue: unknown[][] = [];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  let channelRows: unknown[] = [];
  const reminder = (over: Record<string, unknown> = {}) => ({ id: "i1", organization_id: "org-a", project_id: "p1", created_at: new Date("2026-11-14T08:00:00Z"), reopened_at: null, renotify_count: 2, prev_count: 1, prev_at: new Date("2026-11-14T08:15:00Z"), max: 3, ...over });
  const escalation = (over: Record<string, unknown> = {}) => ({ id: "e1", organization_id: "org-a", project_id: "p1", escalate_channel_id: "c1", escalate_user_id: null, ...over });
  const now = new Date("2026-11-14T10:00:00Z");

  beforeEach(() => {
    executeQueue.length = 0;
    updates.length = 0;
    inserts.length = 0;
    channelRows = [{ type: "slack", config: {}, projectId: "p1" }];
    db.execute = jest.fn(async () => executeQueue.shift() ?? []);
    db.update = jest.fn(() => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => undefined }; } }));
    db.insert = jest.fn(() => ({ values: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve(); } }));
    db.select = jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => channelRows }) }) }));
    notifyIncidentEvent.mockReset().mockResolvedValue(true);
    mockHeld.mockReset().mockResolvedValue(false);
    resetHeldIncidentsForTest();
  });

  it("skips incidents found held for maintenance in later ticks for a few minutes, then rechecks them", async () => {
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
    const params = (call: number) => new PgDialect().sqlToQuery((db.execute as jest.Mock).mock.calls[call][0]).params as unknown[];
    mockHeld.mockResolvedValueOnce(true);
    executeQueue.push([reminder()], [], []);
    await renotifyUnacknowledgedIncidents(now);
    (db.execute as jest.Mock).mockClear();
    await renotifyUnacknowledgedIncidents(new Date(now.getTime() + 60_000));
    expect(params(0)).toContain("i1");
    (db.execute as jest.Mock).mockClear();
    await renotifyUnacknowledgedIncidents(new Date(now.getTime() + 6 * 60_000));
    expect(params(0)).not.toContain("i1");
  });

  it("sends a claimed reminder with its number and per-reminder dedupe key", async () => {
    executeQueue.push([reminder()], [], []);
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(1);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "unacknowledged", reminder: { n: 2, of: 3 }, dedupeDiscriminator: "renotify:0:2" }));
    expect(updates).toEqual([]);
    expect(incr).toHaveBeenCalledTimes(1);
  });

  it("releases to the previous count and time when the send fails, and counts the failure", async () => {
    executeQueue.push([reminder()], [], []);
    notifyIncidentEvent.mockResolvedValueOnce(false);
    const stats = { failed: 0 };
    await renotifyUnacknowledgedIncidents(now, stats);
    expect(stats.failed).toBe(1);
    expect(updates).toEqual([{ renotifyCount: 1, renotifiedAt: new Date("2026-11-14T08:15:00Z") }]);
    // A failed send does not count against the org's cap.
    expect(incr).not.toHaveBeenCalled();
  });

  it("releases without sending while held for maintenance or over the org cap", async () => {
    mockHeld.mockResolvedValueOnce(true);
    executeQueue.push([reminder()], [], []);
    await renotifyUnacknowledgedIncidents(now);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);

    updates.length = 0;
    for (let i = 0; i < ORG_SENDS_PER_HOUR; i++) await recordOrgIncidentSend("org-a", now);
    // A capped org is skipped for the rest of the tick (its id goes to the claim SQL), and holds are not counted as sends.
    executeQueue.push([reminder()], [], [escalation()], []);
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(0);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([{ renotifyCount: 1, renotifiedAt: expect.any(Date) }, { escalatedAt: null }]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("escalates to a usable channel", async () => {
    executeQueue.push([], [escalation()], []);
    expect(await renotifyUnacknowledgedIncidents(now)).toBe(1);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "escalated", targets: { providerIds: ["c1"] } }));
  });

  it("escalates to a member who can act", async () => {
    mockAssignable.mockResolvedValueOnce(true);
    executeQueue.push([], [escalation({ escalate_channel_id: null, escalate_user_id: "u1" })], []);
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
    executeQueue.push([], [row], []);
    await renotifyUnacknowledgedIncidents(now);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(inserts).toEqual([expect.objectContaining({ eventType: "notification", eventData: expect.objectContaining({ kind: "escalation", reached: 0 }) })]);
  });

  it("releases an escalation whose send failed or whose target lookup threw", async () => {
    executeQueue.push([], [escalation()], []);
    notifyIncidentEvent.mockRejectedValueOnce(new Error("down"));
    const stats = { failed: 0 };
    await renotifyUnacknowledgedIncidents(now, stats);
    expect(stats.failed).toBe(1);
    expect(updates).toEqual([{ escalatedAt: null }]);

    updates.length = 0;
    db.select = jest.fn(() => { throw new Error("db down"); });
    executeQueue.push([], [escalation()], []);
    await renotifyUnacknowledgedIncidents(now);
    expect(updates).toEqual([{ escalatedAt: null }]);
  });
});
