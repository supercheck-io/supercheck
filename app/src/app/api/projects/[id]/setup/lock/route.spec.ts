/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async () => {
    const { NextResponse } = jest.requireActual("next/server");
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: jest.fn(),
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSetupLockRateLimit: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/setup/setup-state", () => ({ claimLock: jest.fn(), releaseLock: jest.fn(), getSetupState: jest.fn() }));

import { DELETE, POST } from "./route";
import { requireAuth, resolveProjectPermissionContext, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSetupLockRateLimit } from "@/lib/sre/sre-rate-limiter";
import { claimLock, getSetupState, releaseLock } from "@/lib/setup/setup-state";
import { logAuditEvent } from "@/lib/audit-logger";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: "u1", organizationId: ORG, orgPendingDeletion: false, project: { id: PROJECT, userRole: "project_editor" } };
const lock = { userId: "u1", userName: "Me", lockedAt: "2026-01-01T00:00:00.000Z", mine: true };
const params = { params: Promise.resolve({ id: PROJECT }) };
const req = (method: string, headers: Record<string, string> = {}, body?: unknown) =>
  new NextRequest(`http://localhost/api/projects/${PROJECT}/setup/lock`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
  (resolveProjectPermissionContext as jest.Mock).mockResolvedValue(ctx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
  (checkSetupLockRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (claimLock as jest.Mock).mockResolvedValue({ kind: "ok", lock });
});

describe.each([
  ["POST", POST],
  ["DELETE", DELETE],
])("%s guard", (method, handler) => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await handler(req(method), params)).status).toBe(403);
    expect(claimLock).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });
  it("404 cross-org and malformed id", async () => {
    (resolveProjectPermissionContext as jest.Mock).mockResolvedValue(null);
    expect((await handler(req(method), params)).status).toBe(404);
    expect((await handler(req(method), { params: Promise.resolve({ id: "x" }) })).status).toBe(404);
  });
  it("401 anonymous and bearer", async () => {
    (requireAuth as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect((await handler(req(method), params)).status).toBe(401);
    expect((await handler(req(method, { authorization: "Bearer t" }), params)).status).toBe(401);
  });
  it("429 when rate limited", async () => {
    (checkSetupLockRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 5000 });
    const res = await handler(req(method), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST claim / heartbeat", () => {
  it("200 with the lock, scoped by the path project", async () => {
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lock });
    expect(claimLock).toHaveBeenCalledWith(ORG, PROJECT, "u1", false);
  });
  it("423 when another user holds it", async () => {
    const other = { ...lock, userId: "u2", mine: false };
    (claimLock as jest.Mock).mockResolvedValue({ kind: "locked", lock: other });
    const res = await POST(req("POST"), params);
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: "locked", lock: other });
  });
  it("uses the effective (impersonated) user", async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ userId: "eff" });
    await POST(req("POST"), params);
    expect(claimLock).toHaveBeenCalledWith(ORG, PROJECT, "eff", false);
  });
  it("500 on failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (claimLock as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await POST(req("POST"), params)).status).toBe(500);
  });
});

describe("POST takeover", () => {
  const other = { ...lock, userId: "u2", mine: false };
  beforeEach(() => (getSetupState as jest.Mock).mockResolvedValue({ lock: other }));
  it("403 without project:update and never claims", async () => {
    (checkPermissionWithContext as jest.Mock).mockImplementation((resource: string) => resource !== "project");
    expect((await POST(req("POST", {}, { takeover: true }), params)).status).toBe(403);
    expect(claimLock).not.toHaveBeenCalled();
  });
  it("takes over and audits the previous holder id", async () => {
    const res = await POST(req("POST", {}, { takeover: true }), params);
    expect(res.status).toBe(200);
    expect(claimLock).toHaveBeenCalledWith(ORG, PROJECT, "u1", true);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "project_setup.lock_taken_over", metadata: { previousHolderId: "u2" } }));
  });
  it("does not audit when nobody held the lock", async () => {
    (getSetupState as jest.Mock).mockResolvedValue({ lock: null });
    await POST(req("POST", {}, { takeover: true }), params);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
  it("a plain POST ignores a non-true takeover flag", async () => {
    await POST(req("POST", {}, { takeover: "yes" }), params);
    expect(claimLock).toHaveBeenCalledWith(ORG, PROJECT, "u1", false);
  });
});

describe("DELETE release", () => {
  it("204 and releases only for the caller", async () => {
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(204);
    expect(releaseLock).toHaveBeenCalledWith(ORG, PROJECT, "u1");
  });
  it("500 on failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (releaseLock as jest.Mock).mockRejectedValue(new Error("db"));
    expect((await DELETE(req("DELETE"), params)).status).toBe(500);
  });
});
