/** @jest-environment node */
const select = jest.fn();
const insert = jest.fn();
// The stored-policy read (it selects renotifyMax) is answered from `storedPolicy`; other selects come from `select`.
let storedPolicy: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: {
    select: (...a: unknown[]) =>
      a[0] && typeof a[0] === "object" && "renotifyMax" in (a[0] as object)
        ? { from: () => ({ where: () => ({ limit: async () => storedPolicy }) }) }
        : select(...a),
    insert: (...a: unknown[]) => insert(...a),
  },
}));
const logAuditEvent = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => logAuditEvent(...a) }));
jest.mock("@/lib/notification-providers/crypto", () => ({ decryptNotificationProviderConfig: (config: unknown) => config }));
const isAssignableUser = jest.fn();
jest.mock("./incident-lifecycle", () => ({ isAssignableUser: (...a: unknown[]) => isAssignableUser(...a) }));

import { PgDialect } from "drizzle-orm/pg-core";
import { getNotificationPolicy, isPagingWebhook, saveNotificationPolicy, DEFAULT_NOTIFICATION_POLICY } from "./notification-policy";

const scope = { organizationId: "org-1", projectId: "018f0000-0000-7000-8000-00000000000b", userId: "user-1" };
const channel = "018f0000-0000-7000-8000-0000000000c1";
const member = "018f0000-0000-7000-8000-0000000000d1";
// A current client sends every field; an older one omits the five repeat and escalation fields (tested below).
const legacy = { channelIds: [], emailServiceOwnersOnSev12: false, renotifyUnackedMinutes: 15, autoInvestigateOnOpen: false };
const base = { ...legacy, renotifyRepeatMinutes: null, renotifyMax: 3, escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null };
const whereClauses: unknown[] = [];
const rows = (r: unknown[]) => ({ from: () => ({ where: (w: unknown) => { whereClauses.push(w); const p = Promise.resolve(r); return Object.assign(p, { limit: async () => r }); } }) });
let upserted: { values: Record<string, unknown>; set: Record<string, unknown> } | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  whereClauses.length = 0;
  upserted = undefined;
  storedPolicy = [];
  isAssignableUser.mockResolvedValue(true);
  insert.mockReturnValue({ values: (values: Record<string, unknown>) => ({ onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { upserted = { values, set }; } }) });
});

describe("saveNotificationPolicy rejections (A19)", () => {
  it.each([
    [{ renotifyUnackedMinutes: null, renotifyRepeatMinutes: 60 }, "Set the first reminder before repeating it"],
    [{ renotifyUnackedMinutes: 60, renotifyRepeatMinutes: 1440, renotifyMax: 3 }, "Reminders must finish within 2 days"],
    [{ escalateAfterMinutes: 30, escalateChannelId: channel, escalateUserId: member }, "Escalate to a channel or a member, not both"],
    [{ escalateAfterMinutes: 30 }, "Choose who to escalate to"],
    [{ renotifyRepeatMinutes: 60, renotifyMax: 1 }, "Repeating needs at most 2 or more reminders"],
    [{ renotifyMax: 11 }, "Invalid notification policy"],
    [{ renotifyRepeatMinutes: 4 }, "Invalid notification policy"],
    [{ escalateAfterMinutes: 1441, escalateUserId: member }, "Invalid notification policy"],
    [{ unknownField: true }, "Invalid notification policy"],
  ])("%j -> %s", async (patch, error) => {
    expect(await saveNotificationPolicy(scope, { ...base, ...patch })).toEqual({ success: false, error });
    expect(insert).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("accepts a schedule that ends exactly at 2 days", async () => {
    select.mockReturnValue(rows([]));
    expect(await saveNotificationPolicy(scope, { ...base, renotifyUnackedMinutes: 0 + 1440, renotifyRepeatMinutes: 720, renotifyMax: 3 })).toEqual({ success: true });
  });

  it("rejects channels of another project, scoping the lookup by organization and project", async () => {
    select.mockReturnValue(rows([]));
    expect(await saveNotificationPolicy(scope, { ...base, channelIds: [channel] })).toEqual({ success: false, error: "Some channels do not belong to this project" });
    const query = new PgDialect().sqlToQuery(whereClauses[0] as never);
    expect(query.params).toEqual(expect.arrayContaining([channel, "org-1", scope.projectId]));
  });

  it("rejects an escalation channel that is missing, disabled, unreadable or a paging preset", async () => {
    const input = { ...base, escalateAfterMinutes: 30, escalateChannelId: channel };
    select.mockReturnValueOnce(rows([]));
    expect(await saveNotificationPolicy(scope, input)).toMatchObject({ error: "The escalation channel is not an enabled channel of this project" });
    select.mockReturnValueOnce(rows([{ type: "slack", config: {}, isEnabled: false, projectId: scope.projectId }]));
    expect(await saveNotificationPolicy(scope, input)).toMatchObject({ error: "The escalation channel is not an enabled channel of this project" });
    select.mockReturnValueOnce(rows([{ type: "webhook", config: { preset: "pagerduty" }, isEnabled: true, projectId: scope.projectId }]));
    expect(await saveNotificationPolicy(scope, input)).toMatchObject({ error: "A paging service cannot be the escalation target" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an escalation member who cannot act in this project", async () => {
    isAssignableUser.mockResolvedValue(false);
    expect(await saveNotificationPolicy(scope, { ...base, escalateAfterMinutes: 30, escalateUserId: member })).toMatchObject({ error: "The escalation member is not a member of this project" });
    expect(isAssignableUser).toHaveBeenCalledWith("org-1", scope.projectId, member);
  });
});

it("upserts the full policy and writes the incident_policy_updated audit without addresses", async () => {
  select.mockReturnValue(rows([{ type: "slack", config: { webhookUrl: "https://hooks.slack.com/x" }, isEnabled: true, projectId: scope.projectId }]));
  const input = { ...base, renotifyRepeatMinutes: 60, renotifyMax: 4, escalateAfterMinutes: 45, escalateChannelId: channel };
  expect(await saveNotificationPolicy(scope, input)).toEqual({ success: true });
  expect(upserted?.values).toMatchObject({ organizationId: "org-1", projectId: scope.projectId, renotifyRepeatMinutes: 60, renotifyMax: 4, escalateAfterMinutes: 45, escalateChannelId: channel, escalateUserId: null });
  expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
    userId: "user-1", organizationId: "org-1", action: "incident_policy_updated", resourceId: scope.projectId,
    metadata: expect.objectContaining({ renotifyRepeatMinutes: 60, renotifyMax: 4, escalateTarget: "channel" }),
  }));
  expect(JSON.stringify(logAuditEvent.mock.calls[0][0].metadata)).not.toContain("hooks.slack.com");
});

it("an older client's save keeps the stored repeat and escalation settings", async () => {
  const stored = { ...base, renotifyRepeatMinutes: 60, renotifyMax: 4, escalateAfterMinutes: 30, escalateUserId: member, autoInvestigateEnabledAt: null };
  storedPolicy = [stored];
  expect(await saveNotificationPolicy(scope, legacy)).toEqual({ success: true });
  expect(upserted?.set).toMatchObject({ renotifyRepeatMinutes: 60, renotifyMax: 4, escalateAfterMinutes: 30, escalateUserId: member, escalateChannelId: null });
});

it("validates the schedule that will be saved, including stored values an older client omits", async () => {
  const stored = { ...base, renotifyUnackedMinutes: 5, renotifyRepeatMinutes: 300, renotifyMax: 10, autoInvestigateEnabledAt: null };
  storedPolicy = [stored];
  expect(await saveNotificationPolicy(scope, { ...legacy, renotifyUnackedMinutes: 1440 })).toEqual({ success: false, error: "Reminders must finish within 2 days" });
  expect(insert).not.toHaveBeenCalled();
});

it("an older client's first save uses the defaults", async () => {
  expect(await saveNotificationPolicy(scope, legacy)).toEqual({ success: true });
  expect(upserted?.values).toMatchObject({ renotifyRepeatMinutes: null, renotifyMax: 3, escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null });
});

it("stamps the auto-investigate time only while it is on", async () => {
  await saveNotificationPolicy(scope, { ...base, autoInvestigateOnOpen: true });
  expect(upserted?.values.autoInvestigateEnabledAt).toBeInstanceOf(Date);
  expect(upserted?.set.autoInvestigateEnabledAt).not.toBeNull();
  await saveNotificationPolicy(scope, { ...base, autoInvestigateOnOpen: false });
  expect(upserted?.values.autoInvestigateEnabledAt).toBeNull();
  expect(upserted?.set.autoInvestigateEnabledAt).toBeNull();
});

it("returns the defaults for a project without a policy", async () => {
  expect(await getNotificationPolicy(scope.projectId)).toEqual(DEFAULT_NOTIFICATION_POLICY);
});

it("does not re-check an unchanged escalation target, so a stale one cannot block saving other settings", async () => {
  storedPolicy = [{ ...base, escalateAfterMinutes: 30, escalateChannelId: channel, autoInvestigateEnabledAt: null }];
  isAssignableUser.mockResolvedValue(false);
  expect(await saveNotificationPolicy(scope, { ...base, escalateAfterMinutes: 30, escalateChannelId: channel, autoInvestigateOnOpen: true })).toEqual({ success: true });
  expect(select).not.toHaveBeenCalled();
  // A newly chosen target is still checked.
  storedPolicy = [{ ...base, autoInvestigateEnabledAt: null }];
  expect(await saveNotificationPolicy(scope, { ...base, escalateAfterMinutes: 30, escalateUserId: member })).toMatchObject({ error: "The escalation member is not a member of this project" });
});

it("treats presets and templated webhooks as paging, not plain webhooks or other types", () => {
  expect(isPagingWebhook("webhook", { preset: "opsgenie" })).toBe(true);
  expect(isPagingWebhook("webhook", { bodyTemplate: "{}" })).toBe(true);
  expect(isPagingWebhook("webhook", { preset: "custom" })).toBe(false);
  expect(isPagingWebhook("webhook", {})).toBe(false);
  expect(isPagingWebhook("slack", { preset: "pagerduty" })).toBe(false);
});
