/** @jest-environment node */

const selectQueue: unknown[][] = [];
const updateQueue: unknown[][] = [];
const inserts: unknown[] = [];

function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy", "set", "returning"]) {
    node[name] = jest.fn(() => node);
  }
  node.values = jest.fn((value: unknown) => {
    inserts.push(value);
    return node;
  });
  node.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  return node;
}

const executor = {
  select: jest.fn(() => chain(selectQueue.shift() ?? [])),
  update: jest.fn(() => chain(updateQueue.shift() ?? [])),
  insert: jest.fn(() => chain([])),
};

jest.mock("@/utils/db", () => ({
  db: {
    ...{
      select: (...args: unknown[]) => (executor.select as jest.Mock)(...args),
      update: (...args: unknown[]) => (executor.update as jest.Mock)(...args),
      insert: (...args: unknown[]) => (executor.insert as jest.Mock)(...args),
    },
    transaction: (callback: (tx: typeof executor) => unknown) => callback(executor),
  },
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./incident-notifier", () => ({ notifyIncidentEvent: jest.fn().mockResolvedValue(undefined) }));

import { logAuditEvent } from "@/lib/audit-logger";

import {
  MAX_RESOLUTION_SUMMARY_LENGTH,
  acknowledgeIncident,
  addIncidentUpdate,
  announceSystemTransition,
  assignIncident,
  applySourceRecovery,
  getDefaultAssigneeId,
  reopenRecentlyAutoResolved,
  resolveIncident,
} from "./incident-lifecycle";
import { notifyIncidentEvent } from "./incident-notifier";

const actor = {
  organizationId: "018f0000-0000-7000-8000-00000000000a",
  projectId: "018f0000-0000-7000-8000-00000000000b",
  userId: "018f0000-0000-7000-8000-00000000000c",
};
const incidentId = "018f0000-0000-7000-8000-0000000000d1";
const assignee = "018f0000-0000-7000-8000-0000000000e1";
const ref = { id: incidentId, incidentNumber: 7, title: "Checkout down" };

beforeEach(() => {
  jest.clearAllMocks();
  selectQueue.length = 0;
  updateQueue.length = 0;
  inserts.length = 0;
});

describe("assignIncident", () => {
  it("rejects a malformed or non-member assignee before touching the incident", async () => {
    expect(await assignIncident(actor, incidentId, "not-a-uuid")).toMatchObject({ ok: false, code: "invalid" });
    selectQueue.push([]); // membership lookup finds nobody
    const result = await assignIncident(actor, incidentId, assignee);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(executor.update).not.toHaveBeenCalled();
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("returns not_found for an incident outside the project", async () => {
    selectQueue.push([{ id: assignee }], []);
    expect(await assignIncident(actor, incidentId, assignee)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("assigns, records the timeline, audits and notifies once", async () => {
    selectQueue.push([{ id: assignee }], [{ current: null }]);
    updateQueue.push([ref]);
    const result = await assignIncident(actor, incidentId, assignee);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(inserts[0]).toMatchObject({ incidentId, eventType: "state_change", eventData: { state: "assigned", assigneeUserId: assignee } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "sre_incident_assigned", organizationId: actor.organizationId }));
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "assigned", assigneeUserId: assignee, incidentId }));
  });

  it("does nothing when the assignee is unchanged", async () => {
    selectQueue.push([{ id: assignee }], [{ current: assignee }], [ref]);
    updateQueue.push([]);
    expect(await assignIncident(actor, incidentId, assignee)).toMatchObject({ ok: true, changed: false });
    expect(inserts).toHaveLength(0);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("unassigns without a membership check or notification", async () => {
    selectQueue.push([{ current: assignee }]);
    updateQueue.push([ref]);
    expect(await assignIncident(actor, incidentId, null)).toMatchObject({ ok: true, changed: true });
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("records commander changes separately and does not email them as assignees", async () => {
    selectQueue.push([{ id: assignee }], [{ current: null }]);
    updateQueue.push([ref]);
    await assignIncident(actor, incidentId, assignee, "commander");
    expect(inserts[0]).toMatchObject({ eventData: { state: "commander_changed" } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "sre_incident_commander_set" }));
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });
});

describe("acknowledgeIncident", () => {
  it("stamps the first acknowledgement, assigns the acknowledger, and notifies", async () => {
    updateQueue.push([{ ...ref, assigneeUserId: actor.userId }]);
    const result = await acknowledgeIncident(actor, incidentId);
    expect(result).toMatchObject({ ok: true, changed: true, autoAssigned: true });
    expect(inserts[0]).toMatchObject({ eventData: { state: "acknowledged" } });
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "acknowledged" }));
  });

  it("keeps an existing assignee (autoAssigned false)", async () => {
    updateQueue.push([{ ...ref, assigneeUserId: assignee }]);
    expect(await acknowledgeIncident(actor, incidentId)).toMatchObject({ ok: true, autoAssigned: false });
  });

  it("is idempotent: a second acknowledgement changes and notifies nothing", async () => {
    updateQueue.push([]);
    selectQueue.push([{ ...ref, status: "investigating", acknowledgedAt: new Date() }]);
    expect(await acknowledgeIncident(actor, incidentId)).toMatchObject({ ok: true, changed: false });
    expect(inserts).toHaveLength(0);
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("refuses to acknowledge a resolved incident and reports missing ones", async () => {
    updateQueue.push([]);
    selectQueue.push([{ ...ref, status: "resolved", acknowledgedAt: null }]);
    expect(await acknowledgeIncident(actor, incidentId)).toMatchObject({ ok: false, code: "conflict" });
    updateQueue.push([]);
    selectQueue.push([]);
    expect(await acknowledgeIncident(actor, incidentId)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("resolveIncident", () => {
  it("requires a bounded, non-blank summary", async () => {
    expect(await resolveIncident(actor, incidentId, "   ")).toMatchObject({ ok: false, code: "invalid" });
    expect(await resolveIncident(actor, incidentId, "x".repeat(MAX_RESOLUTION_SUMMARY_LENGTH + 1))).toMatchObject({ ok: false, code: "invalid" });
    expect(executor.update).not.toHaveBeenCalled();
  });

  it("resolves with the trimmed summary, writes the timeline, and notifies", async () => {
    updateQueue.push([ref]);
    const result = await resolveIncident(actor, incidentId, "  Rolled back deploy 41.  ");
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(inserts[0]).toMatchObject({ eventData: { state: "resolved", comment: "Rolled back deploy 41." } });
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "resolved", dedupeDiscriminator: expect.any(String) }));
  });

  it("treats an already resolved incident as success without notifying again", async () => {
    updateQueue.push([]);
    selectQueue.push([{ ...ref, status: "resolved" }]);
    expect(await resolveIncident(actor, incidentId, "done")).toMatchObject({ ok: true, changed: false });
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("returns not_found when the incident is outside the tenant", async () => {
    updateQueue.push([]);
    selectQueue.push([]);
    expect(await resolveIncident(actor, incidentId, "done")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("addIncidentUpdate", () => {
  it("validates length, scopes the incident lookup, and stores a comment event", async () => {
    expect(await addIncidentUpdate(actor, incidentId, " ")).toMatchObject({ ok: false, code: "invalid" });
    selectQueue.push([]);
    expect(await addIncidentUpdate(actor, incidentId, "hi")).toMatchObject({ ok: false, code: "not_found" });
    selectQueue.push([ref]);
    expect(await addIncidentUpdate(actor, incidentId, " Checking logs ")).toMatchObject({ ok: true });
    expect(inserts[0]).toMatchObject({ eventType: "comment", eventData: { text: "Checking logs" } });
  });
});

describe("getDefaultAssigneeId", () => {
  const input = { organizationId: actor.organizationId, projectId: actor.projectId, serviceId: "018f0000-0000-7000-8000-0000000000f1" };

  it("is unassigned without a service or when the service is outside the project", async () => {
    expect(await getDefaultAssigneeId(executor as never, { ...input, serviceId: null })).toBeNull();
    selectQueue.push([]);
    expect(await getDefaultAssigneeId(executor as never, input)).toBeNull();
  });

  it("prefers the service owner user when still an assignable member", async () => {
    selectQueue.push([{ ownerUserId: assignee }], [], [{ id: assignee }]);
    expect(await getDefaultAssigneeId(executor as never, input)).toBe(assignee);
  });

  it("falls back to the primary user owner, skipping owners who are no longer members", async () => {
    const stale = "018f0000-0000-7000-8000-0000000000e2";
    selectQueue.push([{ ownerUserId: stale }], [{ ownerRef: assignee }, { ownerRef: "team-platform" }], [], [{ id: assignee }]);
    expect(await getDefaultAssigneeId(executor as never, input)).toBe(assignee);
  });

  it("leaves the incident unassigned when no owner is assignable", async () => {
    selectQueue.push([{ ownerUserId: assignee }], [], []);
    expect(await getDefaultAssigneeId(executor as never, input)).toBeNull();
  });
});

describe("applySourceRecovery", () => {
  const source = {
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    sourceType: "monitor" as const,
    sourceId: "mon-1",
    targetName: "Checkout API",
    recoveredAt: new Date("2026-01-01T01:30:00Z"),
  };
  const open = (acknowledgedAt: Date | null) => ({
    id: incidentId,
    incidentNumber: 7,
    title: "t",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    acknowledgedAt,
    assigneeUserId: assignee,
  });

  it("auto-resolves an unacknowledged incident with an automatic timeline event", async () => {
    selectQueue.push([open(null)], []);
    updateQueue.push([{ id: incidentId }]);
    const result = await applySourceRecovery(executor as never, { ...source, autoResolve: true });
    expect(result).toEqual({ resolved: [{ id: incidentId }], recovered: [] });
    expect(inserts[0]).toMatchObject({
      incidentId,
      actorType: "system",
      eventData: {
        state: "resolved",
        automatic: true,
        comment: "Recovered automatically: Checkout API passed again after 1h 30m.",
      },
    });
  });

  it("only notes recovery on an acknowledged incident", async () => {
    selectQueue.push([open(new Date())], [], []);
    const result = await applySourceRecovery(executor as never, { ...source, autoResolve: true });
    expect(executor.update).not.toHaveBeenCalled();
    expect(result.recovered).toEqual([{ id: incidentId, assigneeUserId: assignee }]);
    expect(inserts[0]).toMatchObject({ eventData: { state: "recovered", comment: "Checkout API recovered; resolve when you've confirmed" } });
  });

  it("only notes recovery when autoResolveIncident is off", async () => {
    selectQueue.push([open(null)], [], []);
    const result = await applySourceRecovery(executor as never, { ...source, autoResolve: false });
    expect(executor.update).not.toHaveBeenCalled();
    expect(result.resolved).toEqual([]);
    expect(result.recovered).toHaveLength(1);
  });

  it("falls back to a recovered note when the guarded update loses a race", async () => {
    selectQueue.push([open(null)], [], []);
    updateQueue.push([]);
    const result = await applySourceRecovery(executor as never, { ...source, autoResolve: true });
    expect(result.resolved).toEqual([]);
    expect(result.recovered).toHaveLength(1);
  });

  it("ignores a stale recovery when a newer failure alert exists", async () => {
    selectQueue.push([open(null)], [{ id: "newer-failure" }]);
    expect(await applySourceRecovery(executor as never, { ...source, autoResolve: true })).toEqual({ resolved: [], recovered: [] });
    expect(executor.update).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("does not repeat the recovered note", async () => {
    selectQueue.push([open(new Date())], [], [{ state: "recovered" }]);
    expect(await applySourceRecovery(executor as never, { ...source, autoResolve: true })).toEqual({ resolved: [], recovered: [] });
    expect(inserts).toHaveLength(0);
  });

  it("scopes the open-incident lookup to recoverable failure alert types (not ssl_expiring)", async () => {
    selectQueue.push([]);
    await applySourceRecovery(executor as never, { ...source, autoResolve: true });
    const where = (executor.select.mock.results[0].value as { where: jest.Mock }).where.mock.calls[0][0];
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
    const text = JSON.stringify(new PgDialect().sqlToQuery(where).params);
    expect(text).toContain("monitor_failure");
    expect(text).toContain("job_failed");
    expect(text).toContain("job_timeout");
    expect(text).not.toContain("ssl_expiring");
  });

  it("does nothing when no incident is open", async () => {
    selectQueue.push([]);
    expect(await applySourceRecovery(executor as never, { ...source, autoResolve: true })).toEqual({ resolved: [], recovered: [] });
    expect(inserts).toHaveLength(0);
  });
});

describe("reopenRecentlyAutoResolved", () => {
  const source = {
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    sourceType: "monitor" as const,
    sourceId: "mon-1",
    firedAt: new Date("2026-01-01T02:00:00Z"),
  };
  const latest = (over: Record<string, unknown> = {}) => ({
    id: incidentId,
    status: "resolved",
    resolvedAt: new Date("2026-01-01T01:45:00Z"),
    assigneeUserId: assignee,
    triageInvestigationRunId: null,
    ...over,
  });

  it("reopens an auto-resolved incident inside the 30 minute window", async () => {
    selectQueue.push([latest()], [{ state: "resolved", automatic: "true" }]);
    updateQueue.push([{ id: incidentId }]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toEqual({
      incidentId,
      assigneeUserId: assignee,
      alreadyTriaged: false,
      stale: false,
    });
    expect(inserts[0]).toMatchObject({ eventData: { state: "reopened" }, actorType: "system" });
  });

  it("hands back a failure that fired before the resolve as stale, without reopening", async () => {
    selectQueue.push([latest({ resolvedAt: new Date(source.firedAt.getTime() + 60_000) })]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toMatchObject({ incidentId, stale: true });
    expect(executor.update).not.toHaveBeenCalled();
  });

  it("does not reopen outside the window", async () => {
    selectQueue.push([latest({ resolvedAt: new Date("2026-01-01T01:29:00Z") })]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
    expect(executor.update).not.toHaveBeenCalled();
  });

  it("does not reopen after auto-resolve, reopen, then a manual resolve", async () => {
    selectQueue.push([latest()], [{ state: "resolved", automatic: null }]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
    selectQueue.push([latest()], [{ state: "reopened", automatic: null }]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
    expect(executor.update).not.toHaveBeenCalled();
  });

  it("does not reopen a manually resolved incident", async () => {
    selectQueue.push([latest()], []);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
    expect(executor.update).not.toHaveBeenCalled();
  });

  it("does nothing when the latest incident is still open or absent", async () => {
    selectQueue.push([latest({ status: "triggered", resolvedAt: null })]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
    selectQueue.push([]);
    expect(await reopenRecentlyAutoResolved(executor as never, source)).toBeNull();
  });
});

describe("announceSystemTransition", () => {
  const announce = (event: "resolved" | "recovered" | "reopened") =>
    announceSystemTransition(actor.organizationId, actor.projectId, incidentId, event, {
      assigneeUserId: assignee,
      discriminator: "d1",
    });

  it("audits and notifies, marking resolved and reopened as automatic", async () => {
    await announce("resolved");
    await announce("recovered");
    await announce("reopened");
    const calls = (notifyIncidentEvent as jest.Mock).mock.calls.map(([arg]) => [arg.event, arg.automatic]);
    expect(calls).toEqual([["resolved", true], ["recovered", false], ["reopened", true]]);
    expect(notifyIncidentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeUserId: assignee, dedupeDiscriminator: "d1", incidentId }),
    );
    const actions = (logAuditEvent as jest.Mock).mock.calls.map(([arg]) => arg.action);
    expect(actions).toEqual(["sre_incident_auto_resolved", "sre_incident_recovered", "sre_incident_reopened"]);
  });

  it("still notifies when the audit write fails", async () => {
    (logAuditEvent as jest.Mock).mockRejectedValueOnce(new Error("audit down"));
    await expect(announce("reopened")).resolves.toBeUndefined();
    expect(notifyIncidentEvent).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the notification fails", async () => {
    (notifyIncidentEvent as jest.Mock).mockRejectedValueOnce(new Error("notify down"));
    await expect(announce("resolved")).resolves.toBeUndefined();
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });
});
