/** @jest-environment node */
import { NextRequest } from "next/server";

const mockIssue = jest.fn();
const mockRequireAuth = jest.fn();
const mockCheckPermission = jest.fn();
const mockAudit = jest.fn();
const mockImpersonated = jest.fn();

jest.mock("@/lib/auth/cli-key-service", () => ({
  MAX_CLI_TOKENS_PER_PROJECT: 20,
  issueCliApiKeyAtomically: (...a: unknown[]) => mockIssue(...a),
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: (e: unknown) => e instanceof Error && e.message === "auth",
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCheckPermission(...a),
  isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => mockAudit(...a) }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/logger/pino-config", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { POST } from "./route";

const context = { userId: "u1", organizationId: "o1", project: { id: "p1" } };
const req = (body: unknown) =>
  new NextRequest("https://app.example.com/api/cli-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const created = (expiresAt: Date | null = null) => ({
  ok: true,
  key: { id: "k1", name: "CI", start: "sck_live_ab...", plaintext: "sck_live_secret", expiresAt, createdAt: new Date("2026-10-20T00:00:00Z") },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAuth.mockResolvedValue(context);
  mockCheckPermission.mockReturnValue(true);
  mockImpersonated.mockResolvedValue(false);
});

describe("POST /api/cli-tokens", () => {
  afterEach(() => jest.useRealTimers());

  it("creates a token, returns the plaintext once and audits without the secret", async () => {
    mockIssue.mockResolvedValue(created(new Date("2026-11-20T00:00:00Z")));
    const res = await POST(req({ name: "  CI  ", expiresIn: 86400 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toMatchObject({ id: "k1", key: "sck_live_secret", enabled: true, expiresAt: "2026-11-20T00:00:00.000Z" });
    expect(mockIssue).toHaveBeenCalledWith({ userId: "u1", organizationId: "o1", projectId: "p1", name: "CI", expiresInSeconds: 86400, notAfter: null });
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("sck_live_secret");
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: "cli_token_created", resourceId: "k1" });
  });

  it("keeps the legacy status codes and messages for cap and duplicate name", async () => {
    mockIssue.mockResolvedValueOnce({ ok: false, reason: "limit_reached" });
    let res = await POST(req({ name: "a" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Maximum of 20 CLI tokens per project reached");
    mockIssue.mockResolvedValueOnce({ ok: false, reason: "name_conflict" });
    res = await POST(req({ name: "a" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A CLI token with this name already exists");
  });

  it("validates input before touching the database", async () => {
    expect((await POST(req({ name: "" }))).status).toBe(400);
    expect((await POST(req({ name: "a", expiresIn: 10 }))).status).toBe(400);
    expect((await POST(req("not json"))).status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("enforces apiKey:create and authentication", async () => {
    mockCheckPermission.mockReturnValue(false);
    expect((await POST(req({ name: "a" }))).status).toBe(403);
    mockRequireAuth.mockRejectedValue(new Error("auth"));
    expect((await POST(req({ name: "a" }))).status).toBe(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("refuses to create a token while impersonating a user", async () => {
    mockImpersonated.mockResolvedValue(true);
    const res = await POST(req({ name: "a" }));
    expect(res.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("does not apply the impersonation check to CLI-token authenticated requests", async () => {
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true });
    mockImpersonated.mockResolvedValue(true);
    mockIssue.mockResolvedValue(created());
    const res = await POST(req({ name: "a" }));
    expect(res.status).toBe(201);
    expect(mockImpersonated).not.toHaveBeenCalled();
  });

  it("caps a token created by a CLI token at the parent token's expiry", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-27T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    const parentExpiry = new Date(Date.now() + 2 * 86400 * 1000);
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: parentExpiry });
    mockIssue.mockResolvedValue(created());
    expect((await POST(req({ name: "a", expiresIn: 365 * 86400 }))).status).toBe(201);
    expect((await POST(req({ name: "b" }))).status).toBe(201);
    expect((await POST(req({ name: "c", expiresIn: 3600 }))).status).toBe(201);
    const issued = mockIssue.mock.calls.map(([input]) => input.expiresInSeconds);
    expect(issued).toEqual([2 * 86400, 2 * 86400, 3600]);
  });

  it("leaves expiry alone for browser sessions and non-expiring CLI tokens", async () => {
    mockIssue.mockResolvedValue(created());
    await POST(req({ name: "a" }));
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: null });
    await POST(req({ name: "b", expiresIn: 365 * 86400 }));
    expect(mockIssue.mock.calls.map(([input]) => input.expiresInSeconds)).toEqual([undefined, 365 * 86400]);
  });

  it("passes the parent expiry as a write-time bound and maps an expired parent to 401", async () => {
    const parentExpiry = new Date(Date.now() + 86400_000);
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: parentExpiry });
    mockIssue.mockResolvedValueOnce({ ok: false, reason: "parent_expired" });
    expect((await POST(req({ name: "a" }))).status).toBe(401);
    expect(mockIssue.mock.calls[0][0]).toMatchObject({ notAfter: parentExpiry });
  });

  it("returns a generic 500 without leaking internals", async () => {
    mockIssue.mockRejectedValue(new Error("connection string postgres://secret"));
    const res = await POST(req({ name: "a" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("postgres://");
  });
});
