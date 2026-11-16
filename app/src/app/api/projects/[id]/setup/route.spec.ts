/** @jest-environment node */
import { NextRequest } from "next/server";

const mockLimit = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }) } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: { blockUntilSubscribed: jest.fn() } }));
jest.mock("@/lib/ai/ai-provider", () => ({ isAIProviderConfigured: () => false }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async (_org: string, message: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return NextResponse.json({ error: message }, { status: 403 });
  }),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: jest.fn(),
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSetupReadRateLimit: jest.fn(),
  checkSetupWriteRateLimit: jest.fn(),
}));
jest.mock("@/lib/setup/setup-state", () => ({
  getSetupState: jest.fn(),
  getChecklistCounts: jest.fn(),
  monitorsRemaining: jest.fn(),
  updateSetupState: jest.fn(),
}));

import { GET, PUT } from "./route";
import { subscriptionService } from "@/lib/services/subscription-service";
import { logAuditEvent } from "@/lib/audit-logger";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { requireAuth, resolveProjectPermissionContext, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSetupReadRateLimit, checkSetupWriteRateLimit } from "@/lib/sre/sre-rate-limiter";
import { getChecklistCounts, getSetupState, monitorsRemaining, updateSetupState } from "@/lib/setup/setup-state";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: "u1", organizationId: ORG, orgPendingDeletion: false, project: { id: PROJECT, userRole: "project_editor" } };
const state = { status: "not_started", currentStep: null, draft: {}, skipped: [], statusPageOptOut: false, lock: null, lastAiRunAt: null, scanResult: null, completedAt: null, dismissedAt: null, updatedAt: null };
const counts = { monitors: 1, heartbeatMonitors: 0, notificationProviders: 0, statusPages: 0, requirements: 0, tests: 0, jobs: 0, connectorsOrAgents: 0, services: 0, membersAndInvites: 1, cliTokens: 0, pushDevices: 0 };

const params = (id = PROJECT) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/projects/${PROJECT}/setup`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

const allow = (denied: string[] = []) =>
  (checkPermissionWithContext as jest.Mock).mockImplementation((resource: string, action: string) => !denied.includes(`${resource}:${action}`));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
  (resolveProjectPermissionContext as jest.Mock).mockResolvedValue(ctx);
  (checkSetupReadRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (checkSetupWriteRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (getSetupState as jest.Mock).mockResolvedValue(state);
  (getChecklistCounts as jest.Mock).mockResolvedValue(counts);
  (monitorsRemaining as jest.Mock).mockResolvedValue(7);
  (subscriptionService.blockUntilSubscribed as jest.Mock).mockResolvedValue(undefined);
  mockLimit.mockResolvedValue([{ name: "Acme" }]);
  allow();
});

describe("GET /api/projects/[id]/setup", () => {
  it("returns state, checklist, features, permissions and monitorsRemaining", async () => {
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ projectId: PROJECT, projectName: "Acme", monitorsRemaining: 7, state });
    expect(body.checklist.items.find((i: { key: string }) => i.key === "monitors").done).toBe(true);
    expect(body.features.aiSre).toBe(false); // no AI provider configured
    expect(body.permissions).toEqual({
      canEdit: true, canUpdateProject: true, canConfigureConnectors: true, canInvite: true,
      canCreateTests: true, canCreateStatusPage: true, canCreateNotification: true,
    });
    expect(getSetupState).toHaveBeenCalledWith(ORG, PROJECT, "u1");
    expect(getChecklistCounts).toHaveBeenCalledWith(ORG, PROJECT);
  });

  it("reports aiTestsLocked for an org that is not on a paid plan", async () => {
    expect((await (await GET(req("GET"), params())).json()).aiTestsLocked).toBe(false);
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValueOnce(new Error("trial"));
    expect((await (await GET(req("GET"), params())).json()).aiTestsLocked).toBe(true);
  });
  it("resolves the project from the path, not the active project", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    (resolveProjectPermissionContext as jest.Mock).mockResolvedValue({ ...ctx, project: { ...ctx.project, id: other } });
    await GET(req("GET"), params(other));
    expect(resolveProjectPermissionContext).toHaveBeenCalledWith("u1", other);
    expect(getChecklistCounts).toHaveBeenCalledWith(ORG, other);
  });

  it("lets a viewer read, with canEdit false", async () => {
    allow(["monitor:create", "test:create"]);
    const body = await (await GET(req("GET"), params())).json();
    expect(body.permissions.canEdit).toBe(false);
    expect(body.permissions.canCreateTests).toBe(false);
  });

  it("401 when unauthenticated", async () => {
    (requireAuth as jest.Mock).mockRejectedValue(new Error("Authentication required"));
    expect((await GET(req("GET"), params())).status).toBe(401);
  });

  it("401 on a bearer header before any auth lookup", async () => {
    const res = await GET(req("GET", undefined, { authorization: "Bearer sck_live_x" }), params());
    expect(res.status).toBe(401);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("404 for a malformed id and for a cross-org or unknown project", async () => {
    expect((await GET(req("GET"), params("nope"))).status).toBe(404);
    (resolveProjectPermissionContext as jest.Mock).mockResolvedValue(null);
    expect((await GET(req("GET"), params())).status).toBe(404);
    expect(getSetupState).not.toHaveBeenCalled();
  });

  it("denies without project:view through the pending-deletion aware response", async () => {
    allow(["project:view"]);
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(403);
    expect(permissionDeniedResponse).toHaveBeenCalledWith(ORG, expect.any(String));
  });

  it("returns the pending-deletion shape when the guard answers it", async () => {
    allow(["project:view"]);
    const { pendingDeletionResponse } = jest.requireActual("@/lib/deletion/org-state");
    (permissionDeniedResponse as jest.Mock).mockResolvedValueOnce(pendingDeletionResponse());
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ORG_PENDING_DELETION");
  });

  it("429 with Retry-After and 503 when the limiter is unavailable", async () => {
    (checkSetupReadRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });
    const limited = await GET(req("GET"), params());
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    (checkSetupReadRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, unavailable: true });
    const down = await GET(req("GET"), params());
    expect(down.status).toBe(503);
    expect(down.headers.get("Retry-After")).toBe("60");
  });

  it("413 on a declared Content-Length over the cap, without reading the body", async () => {
    const request = req("PUT", {}, { "content-length": String(70 * 1024) });
    const text = jest.spyOn(request, "text");
    expect((await PUT(request, params())).status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it("500 on an unexpected failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (getSetupState as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await GET(req("GET"), params())).status).toBe(500);
  });
});

describe("PUT /api/projects/[id]/setup", () => {
  const ok = { kind: "ok", state: { ...state, status: "in_progress", updatedAt: "2026-01-01T00:00:00.000Z" }, previousStatus: "not_started" };

  it("saves and returns the full SetupResponse", async () => {
    (updateSetupState as jest.Mock).mockResolvedValue({ ...ok, previousStatus: "in_progress" });
    const res = await PUT(req("PUT", { expectedUpdatedAt: null, currentStep: "app", skipped: ["tests"] }), params());
    expect(res.status).toBe(200);
    expect((await res.json()).state.status).toBe("in_progress");
    expect(updateSetupState).toHaveBeenCalledWith(ORG, PROJECT, "u1", { currentStep: "app", skipped: ["tests"] }, null);
    expect(logAuditEvent).not.toHaveBeenCalled(); // no status change
  });

  it("audits a status change with from/to only", async () => {
    (updateSetupState as jest.Mock).mockResolvedValue(ok);
    await PUT(req("PUT", { status: "in_progress", draft: { app: { url: "https://secret.example/x" } } }), params());
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", organizationId: ORG, action: "project_setup.updated", resourceId: PROJECT,
      metadata: { from: "not_started", to: "in_progress" },
    }));
  });

  it("audits dismissal as project_setup.dismissed", async () => {
    (updateSetupState as jest.Mock).mockResolvedValue({ ...ok, state: { ...ok.state, status: "dismissed" } });
    await PUT(req("PUT", { status: "dismissed" }), params());
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "project_setup.dismissed", metadata: { from: "not_started", to: "dismissed" } }));
  });

  it("attributes the audit to the effective (impersonated) user", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ userId: "impersonated" });
    (updateSetupState as jest.Mock).mockResolvedValue(ok);
    await PUT(req("PUT", { status: "completed" }), params());
    expect(resolveProjectPermissionContext).toHaveBeenCalledWith("impersonated", PROJECT);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "impersonated" }));
  });

  it("403 for a viewer, without touching state", async () => {
    allow(["monitor:create"]);
    expect((await PUT(req("PUT", { status: "dismissed" }), params())).status).toBe(403);
    expect(updateSetupState).not.toHaveBeenCalled();
  });

  it("404 cross-org, 401 anonymous or bearer, 429 limited", async () => {
    (resolveProjectPermissionContext as jest.Mock).mockResolvedValueOnce(null);
    expect((await PUT(req("PUT", {}), params())).status).toBe(404);
    (requireAuth as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect((await PUT(req("PUT", {}), params())).status).toBe(401);
    expect((await PUT(req("PUT", {}, { Authorization: "Bearer t" }), params())).status).toBe(401);
    (checkSetupWriteRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 1000 });
    expect((await PUT(req("PUT", {}), params())).status).toBe(429);
    expect(updateSetupState).not.toHaveBeenCalled();
  });

  it("409 conflict carries the current state", async () => {
    (updateSetupState as jest.Mock).mockResolvedValue({ kind: "conflict", state });
    const res = await PUT(req("PUT", { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", state });
  });

  it("423 locked carries the lock", async () => {
    const lock = { userId: "u2", userName: "Sam", lockedAt: "2026-01-01T00:00:00.000Z", mine: false };
    (updateSetupState as jest.Mock).mockResolvedValue({ kind: "locked", lock });
    const res = await PUT(req("PUT", {}), params());
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: "locked", lock });
  });

  it("400 for an invalid draft, unknown field, bad status, bad JSON; 413 over 64 KB", async () => {
    (updateSetupState as jest.Mock).mockResolvedValue({ kind: "invalid", error: "app: Unrecognized key" });
    expect((await PUT(req("PUT", { draft: { x: 1 } }), params())).status).toBe(400);
    expect((await PUT(req("PUT", { surprise: 1 }), params())).status).toBe(400);
    expect((await PUT(req("PUT", { status: "done" }), params())).status).toBe(400);
    expect((await PUT(req("PUT", "{not json"), params())).status).toBe(400);
    expect((await PUT(req("PUT", { draft: "x".repeat(70 * 1024) }), params())).status).toBe(413);
  });

  it("500 on an unexpected failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (updateSetupState as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await PUT(req("PUT", {}), params())).status).toBe(500);
  });
});
