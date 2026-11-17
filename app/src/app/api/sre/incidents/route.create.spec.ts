/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const mockRequireAuthContext = jest.fn();
const mockCreate = jest.fn();
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
jest.mock("@/lib/sre/manual-incident", () => ({ createManualIncident: (...args: unknown[]) => mockCreate(...args) }));

import { POST } from "./route";

const context = (userRole: string, orgPendingDeletion = false) => ({
  userId: "user-1", organizationId: "org-1", orgPendingDeletion, project: { id: "project-1", name: "P", userRole },
});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("https://app.example.com/api/sre/incidents", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ ok: true, incident: { id: "i-1", incidentNumber: 3, title: "Down" } });
});

describe("POST /api/sre/incidents", () => {
  it.each(["project_editor", "project_admin", "org_admin", "org_owner", "super_admin"])("lets %s declare an incident (201)", async (role) => {
    mockRequireAuthContext.mockResolvedValue(context(role));
    const response = await post({ title: "Down", severity: "sev2" });
    const res = await POST(response);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, incident: { id: "i-1", incidentNumber: 3, title: "Down" } });
    expect(mockCreate).toHaveBeenCalledWith(context(role), { title: "Down", severity: "sev2" }, "api");
  });

  it("records the CLI as the source from its User-Agent", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    await POST(post({ title: "Down" }, { "user-agent": "supercheck-cli/1.4.0" }));
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), expect.anything(), "cli");
  });

  it("answers 402 with the plan message and code for a lapsed organization", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    mockCreate.mockResolvedValue({ ok: false, code: "subscription_required", error: "Active subscription required." });
    const res = await POST(post({ title: "Down" }));
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Active subscription required.", code: "subscription_required" });
  });

  it("denies a project_viewer with 403 before the core runs", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_viewer"));
    const res = await POST(post({ title: "Down" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("denies a pending-deletion org before the core runs", async () => {
    mockRequireAuthContext.mockResolvedValue(context("org_owner", true));
    const res = await POST(post({ title: "Down" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("answers 401 for no session, an invalid key or a job trigger key (auth context rejects them)", async () => {
    mockRequireAuthContext.mockRejectedValue(new Error("auth: trigger tokens can only be used for job triggers"));
    const res = await POST(post({ title: "Down" }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an explicit cross-site Origin", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    const res = await POST(post({ title: "Down" }, { origin: "https://evil.example.net" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps core results to status codes", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    expect((await POST(post("{not json"))).status).toBe(400);
    mockCreate.mockResolvedValueOnce({ ok: false, code: "invalid", error: "Incident title is required", fieldErrors: { title: ["Incident title is required"] } });
    const invalid = await POST(post({ title: "" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Incident title is required", fieldErrors: { title: ["Incident title is required"] } });
    mockCreate.mockResolvedValueOnce({ ok: false, code: "not_found", error: "A selected service or monitor was not found in this project" });
    expect((await POST(post({ title: "x" }))).status).toBe(404);
    mockCreate.mockResolvedValueOnce({ ok: false, code: "forbidden", error: "no" });
    expect((await POST(post({ title: "x" }))).status).toBe(403);
    mockCreate.mockResolvedValueOnce({ ok: false, code: "rate_limited", error: "Too many incidents declared. Try again shortly.", retryAfterSeconds: 12 });
    const limited = await POST(post({ title: "x" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("12");
    mockCreate.mockResolvedValueOnce({ ok: true, incident: { id: "i-2", incidentNumber: 4, title: "x" }, warning: "status_page_failed" });
    expect(await (await POST(post({ title: "x" }))).json()).toMatchObject({ success: true, warning: "status_page_failed" });
    mockCreate.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(post({ title: "x" }))).status).toBe(500);
  });
});

describe("POST /api/sre/incidents origin and body-size guards", () => {
  const { jsonRequest, declaredOversizeRequest, streamedOversizeRequest, SAME_ORIGIN } =
    jest.requireActual("@/lib/security/request-hardening.spec-helpers") as typeof import("@/lib/security/request-hardening.spec-helpers");

  it("accepts a same-origin cookie session and a CLI bearer token that sends no Origin", async () => {
    mockRequireAuthContext.mockResolvedValue(context("project_editor"));
    expect((await POST(jsonRequest("/api/sre/incidents", "POST", { title: "Down" }, { origin: SAME_ORIGIN }))).status).toBe(201);
    expect((await POST(jsonRequest("/api/sre/incidents", "POST", { title: "Down" }, { authorization: "Bearer sck_live_x" }))).status).toBe(201);
  });

  it.each([["declared", declaredOversizeRequest], ["streamed", streamedOversizeRequest]])(
    "refuses a %s body over 256 KB with 413",
    async (_kind, make) => {
      mockRequireAuthContext.mockResolvedValue(context("project_editor"));
      expect((await POST(make("/api/sre/incidents", "POST", 256 * 1024 + 1))).status).toBe(413);
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );
});
