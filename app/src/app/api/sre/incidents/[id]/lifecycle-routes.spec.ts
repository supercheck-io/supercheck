/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const lifecycle = { resolveIncident: jest.fn(), acknowledgeIncident: jest.fn(), assignIncident: jest.fn() };
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  MAX_RESOLUTION_SUMMARY_LENGTH: 2000,
  resolveIncident: (...a: unknown[]) => lifecycle.resolveIncident(...a),
  acknowledgeIncident: (...a: unknown[]) => lifecycle.acknowledgeIncident(...a),
  assignIncident: (...a: unknown[]) => lifecycle.assignIncident(...a),
}));
let allowed = true;
const requirePermissions = jest.fn();
jest.mock("../../_auth", () => ({
  requireSreSameOriginRequest: jest.fn(() => null),
  requireSreApiPermissions: (...args: unknown[]) => {
    requirePermissions(...args);
    return allowed
      ? { success: true, context: { organizationId: "org-1", userId: "user-1", project: { id: "project-1" } } }
      : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  },
}));

import { POST as acknowledge } from "./acknowledge/route";
import { POST as assign } from "./assign/route";
import { POST as resolve } from "./resolve/route";

const id = "018f0000-0000-7000-8000-0000000000d1";
const params = { params: Promise.resolve({ id }) };
const post = (body?: unknown) =>
  new NextRequest("https://example.com/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const scope = { organizationId: "org-1", projectId: "project-1", userId: "user-1" };

beforeEach(() => {
  jest.clearAllMocks();
  allowed = true;
});

describe("incident lifecycle routes", () => {
  it("require sre_incident update and stop before any data operation when denied", async () => {
    allowed = false;
    expect((await resolve(post({ comment: "ok" }), params)).status).toBe(403);
    expect((await acknowledge(post(), params)).status).toBe(403);
    expect((await assign(post({ assigneeUserId: null }), params)).status).toBe(403);
    expect(requirePermissions).toHaveBeenCalledWith([{ resource: "sre_incident", action: "update" }]);
    expect(Object.values(lifecycle).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("resolve accepts the legacy comment field and the new resolutionSummary field", async () => {
    lifecycle.resolveIncident.mockResolvedValue({ ok: true, incident: { id, incidentNumber: 3, title: "t" }, changed: true });
    expect((await resolve(post({ comment: " fixed " }), params)).status).toBe(200);
    expect(lifecycle.resolveIncident).toHaveBeenLastCalledWith(scope, id, "fixed");
    await resolve(post({ resolutionSummary: "rolled back" }), params);
    expect(lifecycle.resolveIncident).toHaveBeenLastCalledWith(scope, id, "rolled back");
  });

  it("resolve rejects a missing or oversized summary with 400", async () => {
    expect((await resolve(post({}), params)).status).toBe(400);
    expect((await resolve(post({ comment: "x".repeat(2001) }), params)).status).toBe(400);
    expect((await resolve(new NextRequest("https://example.com/x", { method: "POST", body: "{" }), params)).status).toBe(400);
    expect(lifecycle.resolveIncident).not.toHaveBeenCalled();
  });

  it("maps domain failures to 404, 409 and 400", async () => {
    lifecycle.acknowledgeIncident.mockResolvedValueOnce({ ok: false, code: "not_found", error: "Incident not found or access denied" });
    expect((await acknowledge(post(), params)).status).toBe(404);
    lifecycle.acknowledgeIncident.mockResolvedValueOnce({ ok: false, code: "conflict", error: "Incident is already resolved" });
    expect((await acknowledge(post(), params)).status).toBe(409);
    lifecycle.assignIncident.mockResolvedValueOnce({ ok: false, code: "invalid", error: "Assignee must be an editor or admin of this project" });
    const response = await assign(post({ assigneeUserId: "018f0000-0000-7000-8000-0000000000e1" }), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Assignee must be an editor or admin of this project" });
  });

  it("assign validates the body and passes role through", async () => {
    expect((await assign(post({ assigneeUserId: "nope" }), params)).status).toBe(400);
    lifecycle.assignIncident.mockResolvedValue({ ok: true, incident: { id, incidentNumber: 3, title: "t" }, changed: true });
    const assignee = "018f0000-0000-7000-8000-0000000000e1";
    expect((await assign(post({ assigneeUserId: assignee, role: "commander" }), params)).status).toBe(200);
    expect(lifecycle.assignIncident).toHaveBeenCalledWith(scope, id, assignee, "commander");
  });
});
