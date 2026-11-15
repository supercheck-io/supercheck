/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const mockRequireAuthContext = jest.fn();
const mockUpdate = jest.fn();
const mockRateLimit = jest.fn();
const mockIncidentRows: unknown[][] = [];
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mockIncidentRows.shift() ?? [] }) }) }) } }));
const mockList = jest.fn();
jest.mock("@/lib/sre/incident-resources", () => ({ listIncidentResources: (...a: unknown[]) => mockList(...a) }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockRequireAuthContext(),
  isAuthError: (error: unknown) => error instanceof Error && error.message.startsWith("auth:"),
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {}, SubscriptionAccessDeniedError: class extends Error {} }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreIncidentUpdateRateLimit: (...args: unknown[]) => mockRateLimit(...args) }));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async (_org: string, message: string) => NextResponse.json({ error: message }, { status: 403 })),
}));
jest.mock("@/lib/sre/manual-incident", () => ({ updateIncidentResources: (...args: unknown[]) => mockUpdate(...args) }));

import { GET, PATCH } from "./route";

const id = "018f0000-0000-7000-8000-0000000000d1";
const context = (userRole: string) => ({ userId: "user-1", organizationId: "org-1", orgPendingDeletion: false, project: { id: "project-1", userRole } });
const patch = (body: unknown, routeId = id) => PATCH(
  new NextRequest("https://app.example.com/x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }),
  { params: Promise.resolve({ id: routeId }) },
);

beforeEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
  mockUpdate.mockResolvedValue({ ok: true, added: 1, removed: 0 });
});

describe("PATCH /api/sre/incidents/[id]/resources", () => {
  it("updates for an editor", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    const res = await patch({ add: { monitorIds: [id] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, added: 1, removed: 0 });
    expect(mockUpdate).toHaveBeenCalledWith(context("project_editor"), id, { add: { monitorIds: [id] } });
  });

  it("denies a viewer and rejects bad ids and bodies", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_viewer"));
    expect((await patch({ add: { monitorIds: [id] } })).status).toBe(403);
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    expect((await patch({}, "not-a-uuid")).status).toBe(400);
    expect((await patch("{bad")).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps 404, 429 and core denial", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    mockUpdate.mockResolvedValueOnce({ ok: false, code: "not_found", error: "Incident not found or access denied" });
    expect((await patch({ add: { monitorIds: [id] } })).status).toBe(404);
    mockUpdate.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "no" });
    expect((await patch({ add: { monitorIds: [id] } })).status).toBe(403);
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 5000 });
    expect((await patch({ add: { monitorIds: [id] } })).status).toBe(429);
  });
});

describe("GET /api/sre/incidents/[id]/resources", () => {
  it("lists the incident's resources for a viewer, scoped to the project", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_viewer"));
    mockIncidentRows.push([{ id }]);
    mockList.mockResolvedValue([{ type: "monitor", id, name: "API" }]);
    const res = await GET(new NextRequest("https://app.example.com/x"), { params: Promise.resolve({ id }) });
    expect(await res.json()).toEqual({ success: true, resources: [{ type: "monitor", id, name: "API" }] });
    expect(mockList).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "project-1" }, id);
  });
  it("answers 404 for an incident outside the project and 400 for a bad id", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_viewer"));
    mockIncidentRows.push([]);
    expect((await GET(new NextRequest("https://app.example.com/x"), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect((await GET(new NextRequest("https://app.example.com/x"), { params: Promise.resolve({ id: "x" }) })).status).toBe(400);
  });
  it("maps a resolved incident on PATCH to 409", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    mockUpdate.mockResolvedValueOnce({ ok: false, code: "conflict", error: "Reopen the incident" });
    expect((await patch({ add: { monitorIds: [id] } })).status).toBe(409);
  });
});
