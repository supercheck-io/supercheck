/** @jest-environment node */

const mockCtx = {
  userId: "018f0000-0000-7000-8000-00000000000c",
  organizationId: "018f0000-0000-7000-8000-00000000000a",
  project: { id: "018f0000-0000-7000-8000-00000000000b" },
};
const requireProjectContext = jest.fn(async () => mockCtx);
jest.mock("@/lib/project-context", () => ({ requireProjectContext: () => requireProjectContext() }));
const checkPermissionWithContext = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...args: unknown[]) => checkPermissionWithContext(...args) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
jest.mock("@/utils/db", () => ({ db: {} }));

const lifecycle = {
  assignIncident: jest.fn(),
  acknowledgeIncident: jest.fn(),
  resolveIncident: jest.fn(),
  addIncidentUpdate: jest.fn(),
  listAssignableUsers: jest.fn(),
};
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  MAX_INCIDENT_UPDATE_LENGTH: 2000,
  MAX_RESOLUTION_SUMMARY_LENGTH: 2000,
  assignIncident: (...a: unknown[]) => lifecycle.assignIncident(...a),
  acknowledgeIncident: (...a: unknown[]) => lifecycle.acknowledgeIncident(...a),
  resolveIncident: (...a: unknown[]) => lifecycle.resolveIncident(...a),
  addIncidentUpdate: (...a: unknown[]) => lifecycle.addIncidentUpdate(...a),
  listAssignableUsers: (...a: unknown[]) => lifecycle.listAssignableUsers(...a),
}));

import {
  acknowledgeSreIncident,
  addSreIncidentUpdate,
  assignSreIncident,
  getSreIncidentAssignees,
  resolveSreIncident,
} from "./sre-incident-lifecycle";

const incidentId = "018f0000-0000-7000-8000-0000000000d1";
const actor = { organizationId: mockCtx.organizationId, projectId: mockCtx.project.id, userId: mockCtx.userId };

beforeEach(() => {
  jest.clearAllMocks();
  checkPermissionWithContext.mockReturnValue(true);
});

describe("incident lifecycle actions", () => {
  it("denies viewers (no sre_incident update permission) before any data operation", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    for (const result of [
      await assignSreIncident({ incidentId, assigneeUserId: null }),
      await acknowledgeSreIncident({ incidentId }),
      await resolveSreIncident({ incidentId, summary: "done" }),
      await addSreIncidentUpdate({ incidentId, text: "hi" }),
    ]) {
      expect(result).toEqual({ success: false, error: expect.stringContaining("Insufficient permissions") });
    }
    expect(checkPermissionWithContext).toHaveBeenCalledWith("sre_incident", "update", expect.anything());
    for (const fn of Object.values(lifecycle)) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects malformed ids and empty or oversized input at the boundary", async () => {
    expect(await assignSreIncident({ incidentId: "nope", assigneeUserId: null })).toMatchObject({ success: false });
    expect(await assignSreIncident({ incidentId, assigneeUserId: "nope" })).toMatchObject({ success: false });
    expect(await resolveSreIncident({ incidentId, summary: "   " })).toMatchObject({ success: false, error: "A resolution summary is required" });
    expect(await resolveSreIncident({ incidentId, summary: "x".repeat(2001) })).toMatchObject({ success: false });
    expect(await addSreIncidentUpdate({ incidentId, text: "" })).toMatchObject({ success: false });
    expect(Object.values(lifecycle).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("scopes every call to the caller's organization and project", async () => {
    lifecycle.assignIncident.mockResolvedValue({ ok: true, incident: { incidentNumber: 1 }, changed: true });
    const assignee = "018f0000-0000-7000-8000-0000000000e1";
    expect(await assignSreIncident({ incidentId, assigneeUserId: assignee })).toEqual({ success: true, message: "Incident assigned" });
    expect(lifecycle.assignIncident).toHaveBeenCalledWith(actor, incidentId, assignee, "assignee");

    lifecycle.acknowledgeIncident.mockResolvedValue({ ok: true, incident: { incidentNumber: 1 }, changed: false });
    expect(await acknowledgeSreIncident({ incidentId })).toEqual({ success: true, message: "Incident was already acknowledged" });
    expect(lifecycle.acknowledgeIncident).toHaveBeenCalledWith(actor, incidentId);

    lifecycle.resolveIncident.mockResolvedValue({ ok: true, incident: { incidentNumber: 4 }, changed: true });
    expect(await resolveSreIncident({ incidentId, summary: " fixed " })).toEqual({ success: true, message: "Incident #4 resolved" });
    expect(lifecycle.resolveIncident).toHaveBeenCalledWith(actor, incidentId, "fixed");
  });

  it("maps domain failures and unexpected errors to stable messages", async () => {
    lifecycle.assignIncident.mockResolvedValue({ ok: false, code: "invalid", error: "Assignee must be an editor or admin of this project" });
    expect(await assignSreIncident({ incidentId, assigneeUserId: null })).toEqual({ success: false, error: "Assignee must be an editor or admin of this project" });
    lifecycle.acknowledgeIncident.mockRejectedValue(new Error("db password=hunter2"));
    expect(await acknowledgeSreIncident({ incidentId })).toEqual({ success: false, error: "Failed to acknowledge incident" });
  });

  it("lists assignable users only for viewers of the current project", async () => {
    lifecycle.listAssignableUsers.mockResolvedValue([{ id: "u1", name: "Ada", email: "a@x.io", image: null }]);
    expect(await getSreIncidentAssignees()).toMatchObject({ success: true, assignees: [{ id: "u1" }] });
    expect(lifecycle.listAssignableUsers).toHaveBeenCalledWith(mockCtx.organizationId, mockCtx.project.id);
    checkPermissionWithContext.mockReturnValue(false);
    expect(await getSreIncidentAssignees()).toMatchObject({ success: false, assignees: [] });
  });
});
