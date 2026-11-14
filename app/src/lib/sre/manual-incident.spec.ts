jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn(), insert: jest.fn() } }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ getDefaultAssigneeId: jest.fn(), isAssignableUser: jest.fn() }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/sre/incident-watchers", () => ({ watchIncident: jest.fn() }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreIncidentCreateRateLimit: jest.fn() }));
jest.mock("@/lib/status-page-incident-core", () => ({ createStatusPageIncident: jest.fn(), findStatusPageTargetError: jest.fn() }));
jest.mock("@/sre/lib/auto-investigate", () => ({ maybeAutoInvestigateOnOpen: jest.fn().mockResolvedValue({ handled: false }) }));
jest.mock("@/lib/sre/incident-resources", () => ({
  MAX_INCIDENT_RESOURCES: 50,
  resolveIncidentResources: jest.fn(),
  addIncidentResources: jest.fn(async (_tx: unknown, _id: string, resources: unknown[]) => resources),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  // The real role table is exercised by the route spec; here only the decision matters.
  checkPermissionWithContext: jest.fn((resource: string, action: string, ctx: { orgPendingDeletion: boolean; project: { userRole: string } }) =>
    !ctx.orgPendingDeletion && ctx.project.userRole !== "project_viewer" && !(ctx.project.userRole === "no_status_page" && resource === "status_page")),
}));

import { logAuditEvent } from "@/lib/audit-logger";
import { getDefaultAssigneeId, isAssignableUser } from "@/lib/sre/incident-lifecycle";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { resolveIncidentResources } from "@/lib/sre/incident-resources";
import { checkSreIncidentCreateRateLimit } from "@/lib/sre/sre-rate-limiter";
import { createStatusPageIncident, findStatusPageTargetError } from "@/lib/status-page-incident-core";
import { maybeAutoInvestigateOnOpen } from "@/sre/lib/auto-investigate";
import { db } from "@/utils/db";
import { createManualIncident, updateIncidentResources } from "./manual-incident";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = (role = "project_editor", orgPendingDeletion = false) => ({
  userId: id(1), organizationId: id(2), orgPendingDeletion, project: { id: id(3), userRole: role },
});

let values: Array<Record<string, unknown>>;
function mockTransaction(incidentNumber = 7) {
  values = [];
  (db.transaction as jest.Mock).mockImplementation(async (callback) =>
    callback({
      execute: jest.fn(),
      select: () => ({ from: () => ({ where: async () => [{ nextIncidentNumber: incidentNumber }] }) }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          values.push(row);
          return { returning: async () => [{ id: id(9), incidentNumber, title: row.title }] };
        },
      }),
    }),
  );
  (db.insert as jest.Mock).mockReturnValue({ values: (row: Record<string, unknown>) => { values.push(row); return { catch: jest.fn() }; } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransaction();
  jest.mocked(checkSreIncidentCreateRateLimit).mockResolvedValue({ allowed: true, remaining: 9 });
  jest.mocked(resolveIncidentResources).mockResolvedValue([]);
  jest.mocked(getDefaultAssigneeId).mockResolvedValue(null);
  jest.mocked(isAssignableUser).mockResolvedValue(true);
  jest.mocked(findStatusPageTargetError).mockResolvedValue(null);
});

describe("createManualIncident", () => {
  it("declares an incident with the same lifecycle: number, watcher, timeline, audit, notify, auto-investigate", async () => {
    const result = await createManualIncident(actor(), { title: " Checkout down ", severity: "sev2", summary: "Users see 500s" }, "api");
    expect(result).toEqual({ ok: true, incident: { id: id(9), incidentNumber: 7, title: "Checkout down" } });
    expect(values[0]).toMatchObject({ organizationId: id(2), projectId: id(3), severity: "sev2", status: "triggered", assigneeUserId: id(1), createdByUserId: id(1), primaryServiceId: null });
    expect(values[1]).toMatchObject({ eventData: { state: "manual_incident_created", summary: "Users see 500s", createdByUserId: id(1), source: "api" } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "sre_incident_created_manual", metadata: expect.objectContaining({ source: "api", severity: "sev2" }) }));
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "created", actorUserId: id(1), assigneeUserId: id(1) }));
    expect(maybeAutoInvestigateOnOpen).toHaveBeenCalledWith(expect.objectContaining({ incidentId: id(9) }));
  });

  it("defaults severity to sev3 and assigns the service owner, who gets the created email", async () => {
    jest.mocked(getDefaultAssigneeId).mockResolvedValue(id(5));
    jest.mocked(resolveIncidentResources).mockResolvedValue([{ type: "service", id: id(4), name: "Checkout API" }, { type: "monitor", id: id(6), name: "Checkout" }]);
    const result = await createManualIncident(actor(), { title: "t", primaryServiceId: id(4), affected: { monitorIds: [id(6)] }, commanderUserId: id(8) }, "ui");
    expect(result.ok).toBe(true);
    expect(values[0]).toMatchObject({ severity: "sev3", primaryServiceId: id(4), commanderUserId: id(8), assigneeUserId: id(5) });
    expect(resolveIncidentResources).toHaveBeenCalledWith(db, { organizationId: id(2), projectId: id(3) }, { serviceIds: [id(4)], monitorIds: [id(6)] });
    expect(values[2]).toMatchObject({ eventData: { state: "resources_affected", added: [expect.objectContaining({ name: "Checkout API" }), expect.objectContaining({ type: "monitor" })] } });
    expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: id(5) }));
  });

  it("falls back to the creator when the service has no assignable owner", async () => {
    jest.mocked(resolveIncidentResources).mockResolvedValue([{ type: "service", id: id(4), name: "Checkout API" }]);
    await createManualIncident(actor(), { title: "t", primaryServiceId: id(4) }, "ui");
    expect(values[0]).toMatchObject({ assigneeUserId: id(1) });
  });

  it.each([
    ["a viewer", actor("project_viewer"), {}],
    ["a pending-deletion org", actor("project_editor", true), {}],
    ["an editor without status page rights posting publicly", actor("no_status_page"), { statusPage: { statusPageId: id(20), componentIds: [id(21)] } }],
  ])("denies %s before any write", async (_label, who, extra) => {
    const result = await createManualIncident(who, { title: "t", ...extra }, "mcp");
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(checkSreIncidentCreateRateLimit).not.toHaveBeenCalled();
  });

  it("validates input: title, summary length, ids and the 50 resource cap", async () => {
    expect(await createManualIncident(actor(), { title: "  " }, "api")).toMatchObject({ ok: false, code: "invalid", fieldErrors: { title: expect.any(Array) } });
    expect(await createManualIncident(actor(), { title: "t", summary: "x".repeat(4001) }, "api")).toMatchObject({ ok: false, code: "invalid" });
    expect(await createManualIncident(actor(), { title: "t", primaryServiceId: "nope" }, "api")).toMatchObject({ ok: false, code: "invalid" });
    const many = Array.from({ length: 26 }, (_, n) => id(100 + n));
    const more = Array.from({ length: 25 }, (_, n) => id(200 + n));
    expect(await createManualIncident(actor(), { title: "t", affected: { serviceIds: many, monitorIds: more } }, "api")).toMatchObject({ ok: false, code: "invalid" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns 429 data when rate limited", async () => {
    jest.mocked(checkSreIncidentCreateRateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });
    const result = await createManualIncident(actor(), { title: "t" }, "cli");
    expect(result).toMatchObject({ ok: false, code: "rate_limited", retryAfterSeconds: expect.any(Number) });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects services or monitors outside the project, and a commander who cannot act", async () => {
    jest.mocked(resolveIncidentResources).mockResolvedValueOnce(null);
    expect(await createManualIncident(actor(), { title: "t", affected: { monitorIds: [id(6)] } }, "api")).toMatchObject({ ok: false, code: "not_found" });
    jest.mocked(isAssignableUser).mockResolvedValueOnce(false);
    expect(await createManualIncident(actor(), { title: "t", commanderUserId: id(8) }, "api")).toMatchObject({ ok: false, code: "invalid" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a status page or component outside the project before declaring anything", async () => {
    jest.mocked(findStatusPageTargetError).mockResolvedValueOnce("Status page not found or access denied");
    const result = await createManualIncident(actor(), { title: "t", statusPage: { statusPageId: id(20), componentIds: [id(21)] } }, "cli");
    expect(result).toEqual({ ok: false, code: "not_found", error: "Status page not found or access denied" });
    expect(findStatusPageTargetError).toHaveBeenCalledWith({ organizationId: id(2), projectId: id(3) }, id(20), [id(21)]);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(notifyIncidentEvent).not.toHaveBeenCalled();
  });

  it("posts the linked status page incident after commit (AC5)", async () => {
    jest.mocked(createStatusPageIncident).mockResolvedValue({ success: true, message: "ok", incident: { id: id(30) } as never });
    const result = await createManualIncident(actor(), { title: "t", statusPage: { statusPageId: id(20), componentIds: [id(21)], impact: "major", message: "Looking into it" } }, "ui");
    expect(createStatusPageIncident).toHaveBeenCalledWith(actor(), expect.objectContaining({
      sreIncidentId: id(9), statusPageId: id(20), status: "investigating", impact: "major", body: "Looking into it",
      affectedComponentIds: [id(21)], componentStatus: "partial_outage", deliverNotifications: false,
    }));
    expect(result).toMatchObject({ ok: true, statusPageIncidentId: id(30) });
  });

  it.each([
    ["returns a failure", async () => ({ success: false, message: "A selected component is not on this status page." })],
    ["throws", async () => { throw new Error("boom"); }],
  ])("keeps the incident and records a warning when the status page post %s", async (_label, impl) => {
    jest.mocked(createStatusPageIncident).mockImplementation(impl as never);
    const result = await createManualIncident(actor(), { title: "t", statusPage: { statusPageId: id(20), componentIds: [id(21)], notifySubscribers: true } }, "ui");
    expect(result).toMatchObject({ ok: true, incident: { id: id(9) }, warning: "status_page_failed" });
    expect(values.at(-1)).toMatchObject({ incidentId: id(9), eventData: { state: "status_page_post_failed" }, actorType: "system" });
  });
});

describe("updateIncidentResources", () => {
  it("validates, then denies viewers before reading anything", async () => {
    expect(await updateIncidentResources(actor(), "bad", { add: { monitorIds: [id(6)] } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateIncidentResources(actor(), id(9), {})).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateIncidentResources(actor("project_viewer"), id(9), { add: { monitorIds: [id(6)] } })).toMatchObject({ ok: false, code: "forbidden" });
    expect(resolveIncidentResources).not.toHaveBeenCalled();
  });

  it("answers not found for resources or incidents outside the project", async () => {
    jest.mocked(resolveIncidentResources).mockResolvedValueOnce(null);
    expect(await updateIncidentResources(actor(), id(9), { add: { monitorIds: [id(6)] } })).toMatchObject({ ok: false, code: "not_found" });
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) => callback({
      select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
    }));
    expect(await updateIncidentResources(actor(), id(9), { add: { monitorIds: [id(6)] } })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("adds and removes, writes one timeline row and an audit event", async () => {
    jest.mocked(resolveIncidentResources).mockResolvedValueOnce([{ type: "monitor", id: id(6), name: "Checkout" }]);
    const rows: Array<Record<string, unknown>> = [];
    const deleted = jest.fn();
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) => {
      let call = 0;
      return callback({
        select: () => ({ from: () => ({ where: () => (call++ === 0 ? { for: async () => [{ id: id(9) }] } : Promise.resolve([{ id: id(40), type: "monitor", resourceId: id(7) }])) }) }),
        delete: () => ({ where: deleted }),
        insert: () => ({ values: (row: Record<string, unknown>) => { rows.push(row); return Promise.resolve(); } }),
        update: () => ({ set: () => ({ where: jest.fn() }) }),
      });
    });
    const result = await updateIncidentResources(actor(), id(9), { add: { monitorIds: [id(6)] }, remove: { monitorIds: [id(7)] } });
    expect(result).toEqual({ ok: true, added: 1, removed: 1 });
    expect(deleted).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ eventData: { state: "resources_affected", added: [expect.objectContaining({ id: id(6) })], removed: [{ type: "monitor", id: id(7), name: null }] } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "sre_incident_resources_updated" }));
  });

  it("caps the list at 50, counting only resources not already listed", async () => {
    const listed = Array.from({ length: 50 }, (_, n) => ({ id: id(500 + n), type: "monitor", resourceId: id(600 + n) }));
    const tx = (current: unknown[]) => async (callback: (tx: unknown) => unknown) => {
      let call = 0;
      return callback({
        select: () => ({ from: () => ({ where: () => (call++ === 0 ? { for: async () => [{ id: id(9) }] } : Promise.resolve(current)) }) }),
        delete: () => ({ where: jest.fn() }),
        insert: () => ({ values: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: jest.fn() }) }),
      });
    };
    jest.mocked(resolveIncidentResources).mockResolvedValueOnce([{ type: "monitor", id: id(600), name: "Already listed" }]);
    (db.transaction as jest.Mock).mockImplementationOnce(tx(listed));
    expect(await updateIncidentResources(actor(), id(9), { add: { monitorIds: [id(600)] } })).toMatchObject({ ok: true });
    jest.mocked(resolveIncidentResources).mockResolvedValueOnce([{ type: "monitor", id: id(700), name: "New" }]);
    (db.transaction as jest.Mock).mockImplementationOnce(tx(listed));
    expect(await updateIncidentResources(actor(), id(9), { add: { monitorIds: [id(700)] } })).toMatchObject({ ok: false, code: "invalid" });
  });
});
