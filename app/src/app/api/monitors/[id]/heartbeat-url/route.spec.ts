/** @jest-environment node */
import { NextRequest } from "next/server";

const mockSelectRows = jest.fn();
const mockUpdateRows = jest.fn();
const mockSet = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mockSelectRows() }) }) }),
    update: () => ({ set: (values: unknown) => { mockSet(values); return { where: () => ({ returning: async () => mockUpdateRows() }) }; } }),
  },
}));
const mockContext = jest.fn();
class MockAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403 = 401) { super(message); }
}
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockContext(),
  isAuthError: (e: unknown) => e instanceof MockAuthError,
  authErrorStatus: (e: MockAuthError) => e.status,
}));
const mockCanUpdate = jest.fn();
const mockImpersonated = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...args: unknown[]) => mockCanUpdate(...args),
  isImpersonatedSession: () => mockImpersonated(),
}));
const mockPending = jest.fn();
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async (_org: string, message: string) =>
    mockPending() ? Response.json({ error: "pending deletion", code: "ORG_PENDING_DELETION" }, { status: 403 }) : Response.json({ error: message }, { status: 403 }),
}));
jest.mock("@/lib/deletion/visibility", () => ({ liveMonitor: () => undefined }));
const mockRateLimit = jest.fn();
jest.mock("@/lib/session-security", () => ({ checkMonitorApiRateLimit: (...args: unknown[]) => mockRateLimit(...args) }));
const mockAudit = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...args: unknown[]) => mockAudit(...args) }));
const mockLogError = jest.fn();
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: (...args: unknown[]) => mockLogError(...args) }) }));

import { encryptValue } from "@/lib/encryption";
import { GET } from "./route";
import { POST } from "./rotate/route";

const ID = "0195f1f1-0000-7000-8000-000000000001";
const PROJECT = "0195f1f1-0000-7000-8000-0000000000aa";
const TOKEN = `hb_${"ab".repeat(16)}`;
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const reveal = (id = ID) => GET(new NextRequest(`https://app.test/api/monitors/${id}/heartbeat-url`), params(id));
const rotate = (id = ID) => POST(new NextRequest(`https://app.test/api/monitors/${id}/heartbeat-url/rotate`, { method: "POST" }), params(id));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
  mockContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: PROJECT, userRole: "project_editor" }, isCliAuth: false, orgPendingDeletion: false });
  mockCanUpdate.mockReturnValue(true);
  mockImpersonated.mockResolvedValue(false);
  mockPending.mockReturnValue(false);
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockSelectRows.mockResolvedValue([{ name: "Nightly", encrypted: encryptValue(TOKEN, PROJECT) }]);
  mockUpdateRows.mockResolvedValue([{ id: ID }]);
});

describe("GET heartbeat-url (reveal)", () => {
  it("returns the decrypted ping URL to an editor, uncached, and audits without the token", async () => {
    const res = await reveal();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ pingUrl: `https://app.test/api/heartbeat/${TOKEN}` });
    expect(mockCanUpdate).toHaveBeenCalledWith("monitor", "update", expect.anything());
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "o1", "heartbeat_url_reveal", 30, 600_000);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_heartbeat_url_revealed", resourceId: ID, success: true }));
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(TOKEN);
  });

  it("denies a viewer with 403 before touching the monitor", async () => {
    mockCanUpdate.mockReturnValue(false);
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(mockSelectRows).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("answers the pending-deletion code for a member of an organization pending deletion", async () => {
    mockCanUpdate.mockReturnValue(false);
    mockPending.mockReturnValue(true);
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ORG_PENDING_DELETION" });
  });

  it("returns 401 when unauthenticated (including a CLI key without CLI scope)", async () => {
    mockContext.mockRejectedValue(new MockAuthError("Authentication required", 401));
    const res = await reveal();
    expect(res.status).toBe(401);
    expect(mockSelectRows).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed id or a monitor outside the caller's organization and project", async () => {
    expect((await reveal("not-a-uuid")).status).toBe(404);
    mockSelectRows.mockResolvedValue([]);
    expect((await reveal()).status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After over the per-user limit", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const res = await reveal();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(mockSelectRows).not.toHaveBeenCalled();
  });

  it("refuses and audits while a super admin impersonates, but allows CLI keys", async () => {
    mockImpersonated.mockResolvedValue(true);
    const res = await reveal();
    expect(res.status).toBe(403);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_heartbeat_url_impersonation_blocked", success: false }));
    mockContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: PROJECT }, isCliAuth: true, orgPendingDeletion: false });
    expect((await reveal()).status).toBe(200);
  });

  it("answers 409 when no token is stored", async () => {
    mockSelectRows.mockResolvedValue([{ name: "Nightly", encrypted: null }]);
    expect((await reveal()).status).toBe(409);
  });

  it("answers 500 without logging the token when decryption fails", async () => {
    mockSelectRows.mockResolvedValue([{ name: "Nightly", encrypted: "garbage" }]);
    const res = await reveal();
    expect(res.status).toBe(500);
    expect(JSON.stringify(mockLogError.mock.calls)).not.toContain("garbage");
  });

  it("uses the configured public app URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://supercheck.example/";
    expect(await (await reveal()).json()).toEqual({ pingUrl: `https://supercheck.example/api/heartbeat/${TOKEN}` });
  });
});

describe("POST heartbeat-url/rotate", () => {
  it("writes a new hash and ciphertext in one update and returns the new URL", async () => {
    const res = await rotate();
    expect(res.status).toBe(200);
    const { pingUrl } = await res.json();
    const token = pingUrl.split("/").pop();
    expect(token).toMatch(/^hb_[0-9a-f]{32}$/);
    expect(token).not.toBe(TOKEN);
    expect(mockSet).toHaveBeenCalledTimes(1);
    const values = mockSet.mock.calls[0][0];
    expect(values).toEqual(expect.objectContaining({ heartbeatTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), heartbeatTokenEncrypted: expect.any(String) }));
    expect(values).not.toHaveProperty("heartbeatState");
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "o1", "heartbeat_url_rotate", 10, 600_000);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "monitor_heartbeat_url_rotated" }));
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(token);
  });

  it("returns 404 when the monitor disappears between the read and the update", async () => {
    mockUpdateRows.mockResolvedValue([]);
    expect((await rotate()).status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("denies a viewer", async () => {
    mockCanUpdate.mockReturnValue(false);
    expect((await rotate()).status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe("POST heartbeat-url/rotate cross-origin guard", () => {
  const rotateFrom = (headers: Record<string, string>) =>
    POST(new NextRequest(`https://app.test/api/monitors/${ID}/heartbeat-url/rotate`, { method: "POST", headers }), params(ID));

  it("refuses a cross-origin cookie session and does not rate-limit or rotate", async () => {
    expect((await rotateFrom({ origin: "https://evil.example" })).status).toBe(403);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("does not apply to a CLI bearer token", async () => {
    mockContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: PROJECT }, isCliAuth: true, orgPendingDeletion: false });
    expect((await rotateFrom({ origin: "https://evil.example", authorization: "Bearer sck_live_x" })).status).toBe(200);
  });
});
