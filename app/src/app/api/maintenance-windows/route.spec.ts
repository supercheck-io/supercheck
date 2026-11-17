/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const mockRequireAuthContext = jest.fn();
const mockCore = {
  listMaintenanceWindows: jest.fn(), createMaintenanceWindow: jest.fn(), getMaintenanceWindow: jest.fn(), updateMaintenanceWindow: jest.fn(),
  deleteMaintenanceWindow: jest.fn(), endMaintenanceWindow: jest.fn(), extendMaintenanceWindow: jest.fn(), cancelMaintenanceWindow: jest.fn(),
};
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockRequireAuthContext(),
  isAuthError: (error: unknown) => error instanceof Error && error.message.startsWith("auth:"),
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {}, SubscriptionAccessDeniedError: class extends Error {} }));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async (_org: string, message: string) => NextResponse.json({ error: message }, { status: 403 })),
}));
jest.mock("@/lib/maintenance/windows", () => new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => mockCore[k as keyof typeof mockCore](...a) }));

import { GET, POST } from "./route";
import { DELETE, GET as GET_ONE, PATCH } from "./[id]/route";
import { POST as END } from "./[id]/end/route";
import { POST as EXTEND } from "./[id]/extend/route";
import { POST as CANCEL } from "./[id]/cancel/route";

const id = "018f0000-0000-7000-8000-0000000000d1";
const params = (value = id) => ({ params: Promise.resolve({ id: value }) });
const ctx = (userRole: string, orgPendingDeletion = false) => ({ userId: "u", organizationId: "o", orgPendingDeletion, project: { id: "p", userRole } });
const req = (method: string, body?: unknown, url = "https://app.example.com/api/maintenance-windows", headers: Record<string, string> = {}) =>
  new NextRequest(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mockCore)) fn.mockResolvedValue({ ok: true, window: { id } });
  mockCore.listMaintenanceWindows.mockResolvedValue({ ok: true, windows: [] });
});

describe("maintenance window routes", () => {
  it("lets a viewer list but not create, and an editor create (201)", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("project_viewer"));
    expect((await GET(req("GET", undefined, "https://app.example.com/api/maintenance-windows?state=active"))).status).toBe(200);
    expect(mockCore.listMaintenanceWindows).toHaveBeenCalledWith(ctx("project_viewer"), { state: "active" });
    expect((await POST(req("POST", { title: "x" }))).status).toBe(403);
    expect(mockCore.createMaintenanceWindow).not.toHaveBeenCalled();
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    const created = await POST(req("POST", { title: "x" }, undefined, { "user-agent": "supercheck-cli/1.0" }));
    expect(created.status).toBe(201);
    expect(mockCore.createMaintenanceWindow).toHaveBeenCalledWith(ctx("project_editor"), { title: "x" }, "cli");
  });

  it("denies pending-deletion orgs, unauthenticated callers and cross-site writes", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("org_owner", true));
    expect((await POST(req("POST", {}))).status).toBe(403);
    mockRequireAuthContext.mockRejectedValue(new Error("auth: none"));
    expect((await GET(req("GET"))).status).toBe(401);
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await POST(req("POST", {}, undefined, { origin: "https://evil.example.net" }))).status).toBe(403);
    expect(mockCore.createMaintenanceWindow).not.toHaveBeenCalled();
  });

  it("needs delete permission to delete: an editor is denied, an admin allowed", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await DELETE(req("DELETE"), params())).status).toBe(403);
    mockRequireAuthContext.mockResolvedValue(ctx("project_admin"));
    expect((await DELETE(req("DELETE"), params())).status).toBe(200);
  });

  it("validates ids, filters and bodies", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await GET(req("GET", undefined, "https://app.example.com/api/maintenance-windows?state=bogus"))).status).toBe(400);
    expect((await GET_ONE(req("GET"), params("nope"))).status).toBe(400);
    expect((await PATCH(req("PATCH", "{bad"), params())).status).toBe(400);
    expect((await EXTEND(req("POST", "{bad"), params())).status).toBe(400);
  });

  it("maps core results: 404, 409, 429 with Retry-After, field errors", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    mockCore.endMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "conflict", error: "Only an active window can be ended" });
    expect((await END(req("POST"), params())).status).toBe(409);
    mockCore.cancelMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "not_found", error: "Maintenance window not found" });
    expect((await CANCEL(req("POST"), params())).status).toBe(404);
    mockCore.extendMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "rate_limited", error: "slow down", retryAfterSeconds: 7 });
    const limited = await EXTEND(req("POST", { byMinutes: 30 }), params());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("7");
    mockCore.updateMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "invalid", error: "Choose a valid time zone", fieldErrors: { timezone: "Choose a valid time zone" } });
    expect(await (await PATCH(req("PATCH", { timezone: "x" }), params())).json()).toEqual({ error: "Choose a valid time zone", fieldErrors: { timezone: "Choose a valid time zone" } });
    mockCore.getMaintenanceWindow.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "no" });
    expect((await GET_ONE(req("GET"), params())).status).toBe(403);
  });
});

describe("maintenance window origin and body-size guards", () => {
  const { jsonRequest, declaredOversizeRequest, streamedOversizeRequest, SAME_ORIGIN } =
    jest.requireActual("@/lib/security/request-hardening.spec-helpers") as typeof import("@/lib/security/request-hardening.spec-helpers");

  it("accepts a same-origin cookie session and a CLI bearer token that sends no Origin", async () => {
    mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
    expect((await POST(jsonRequest("/api/maintenance-windows", "POST", { title: "x" }, { origin: SAME_ORIGIN }))).status).toBe(201);
    expect((await POST(jsonRequest("/api/maintenance-windows", "POST", { title: "x" }, { authorization: "Bearer sck_live_x" }))).status).toBe(201);
  });

  it.each([["declared", declaredOversizeRequest], ["streamed", streamedOversizeRequest]])(
    "refuses a %s body over 256 KB with 413 on create and update",
    async (_kind, make) => {
      mockRequireAuthContext.mockResolvedValue(ctx("project_editor"));
      expect((await POST(make("/api/maintenance-windows", "POST", 256 * 1024 + 1))).status).toBe(413);
      expect((await PATCH(make(`/api/maintenance-windows/${id}`, "PATCH", 256 * 1024 + 1), params())).status).toBe(413);
      expect(mockCore.createMaintenanceWindow).not.toHaveBeenCalled();
      expect(mockCore.updateMaintenanceWindow).not.toHaveBeenCalled();
    },
  );
});

