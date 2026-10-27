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
  assignIncident,
  getDefaultAssigneeId,
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
