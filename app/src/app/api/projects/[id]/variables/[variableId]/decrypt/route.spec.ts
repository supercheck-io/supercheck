/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";

const mockResolve = jest.fn();
const mockImpersonated = jest.fn();
const mockSlot = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  isImpersonatedSession: () => mockImpersonated(),
  resolveProjectPermissionContext: (...a: unknown[]) => mockResolve(...a),
  checkPermissionWithContext: jest.fn(() => true),
  // Pass-through rate limiter.
  withRateLimit: () => (req: NextRequest, handler: (r: NextRequest, c: unknown) => unknown) => (mockSlot(), handler(req, {})),
}));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn().mockResolvedValue({ userId: "sa-1", isCliAuth: false }),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
const mockDenied = jest.fn(async (_org: string, message: string) => NextResponse.json({ error: message, code: "ORG_PENDING_DELETION" }, { status: 403 }));
jest.mock("@/lib/deletion/org-state", () => ({ permissionDeniedResponse: (...a: [string, string]) => mockDenied(...a) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/encryption", () => ({ decryptValue: jest.fn(() => "plaintext") }));
const mockRows = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => mockRows() }) }) } }));
jest.mock("@/db/schema", () => ({ projectVariables: { id: "id", projectId: "projectId" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn() }));

import { POST } from "./route";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireUserAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { hasPermission, Role } from "@/lib/rbac/permissions";

const PROJECT = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const VARIABLE = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const call = () =>
  POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: PROJECT, variableId: VARIABLE }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockImpersonated.mockResolvedValue(false);
  mockRows.mockResolvedValue([{ isSecret: true, encryptedValue: "enc", key: "K", description: null }]);
});

describe("POST /api/projects/[id]/variables/[variableId]/decrypt", () => {
  it("resolves the caller from real membership, so a non-member super admin gets 404 and no plaintext", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await call();
    expect(mockResolve).toHaveBeenCalledWith("sa-1", PROJECT, { requireMembership: true });
    expect(res.status).toBe(404);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("reveals the value to a member with view_secrets", async () => {
    mockResolve.mockResolvedValue({ userId: "sa-1", organizationId: "org-1", project: { id: PROJECT, userRole: "org_owner" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.value).toBe("plaintext");
  });

  it("refuses to reveal while impersonating, audits the attempt and reads no variable", async () => {
    mockResolve.mockResolvedValue({ userId: "sa-1", organizationId: "org-1", project: { id: PROJECT, userRole: "org_owner" } });
    mockImpersonated.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("plaintext");
    expect(mockRows).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "secret_decrypt_impersonation_blocked", success: false }));
  });

  it("refuses a cross-origin cookie request before reading the secret, but not a CLI token", async () => {
    mockResolve.mockResolvedValue({ userId: "sa-1", organizationId: "org-1", project: { id: PROJECT, userRole: "org_owner" } });
    const cross = (headers: Record<string, string> = {}) => POST(new NextRequest("http://localhost/x", { method: "POST", headers: { origin: "https://evil.example", ...headers } }), {
      params: Promise.resolve({ id: PROJECT, variableId: VARIABLE }),
    });
    expect((await cross()).status).toBe(403);
    expect(mockRows).not.toHaveBeenCalled();
    // Refused before the per-IP limiter counts it, so a cross-site page cannot use up a victim's slots.
    expect(mockSlot).not.toHaveBeenCalled();
    // Any Authorization header (a junk bearer, Basic) is refused the same way from a foreign origin.
    expect((await cross({ authorization: "Basic x" })).status).toBe(403);
    expect(mockSlot).not.toHaveBeenCalled();
    // The CLI sends a bearer token and no Origin.
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "sa-1", isCliAuth: true });
    expect((await call()).status).toBe(200);
  });

  it("does not apply the browser impersonation check to CLI tokens", async () => {
    mockResolve.mockResolvedValue({ userId: "sa-1", organizationId: "org-1", project: { id: PROJECT, userRole: "org_owner" } });
    mockImpersonated.mockResolvedValue(true);
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "sa-1", isCliAuth: true });
    expect((await call()).status).toBe(200);
  });

  it("refuses to reveal while the organization is pending deletion, with the ORG_PENDING_DELETION answer", async () => {
    const ctx = { userId: "sa-1", organizationId: "org-1", orgPendingDeletion: true, project: { id: PROJECT, userRole: "org_owner" } };
    mockResolve.mockResolvedValue(ctx);
    // The real permission table decides: view_secrets is no longer allowed while pending.
    (checkPermissionWithContext as jest.Mock).mockImplementationOnce((resource, action) =>
      hasPermission({ userId: "sa-1", role: Role.ORG_OWNER, orgPendingDeletion: ctx.orgPendingDeletion }, resource, action));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ORG_PENDING_DELETION");
    expect(mockDenied).toHaveBeenCalledWith("org-1", expect.any(String));
    expect(mockRows).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "secret_decrypt_unauthorized", success: false }));
  });
});
