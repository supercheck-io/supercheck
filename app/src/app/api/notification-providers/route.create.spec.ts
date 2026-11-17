/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";

const id = "019a0000-0000-7000-8000-000000000001";
const mockValues = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mockValues(v);
        return { returning: async () => [{ id, ...v }] };
      },
    }),
  },
}));
const mockAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockAuth(),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/creators", () => ({ loadCreators: jest.fn() }));
jest.mock("@/lib/notification-providers/crypto", () => ({
  encryptNotificationProviderConfig: (config: unknown) => config,
  decryptNotificationProviderConfig: (config: unknown) => config,
  sanitizeConfigForClient: (_type: unknown, config: unknown) => ({ sanitizedConfig: config, maskedFields: [] }),
}));

const post = (body: unknown) =>
  POST(new NextRequest("https://example.com/api/notification-providers", { method: "POST", body: JSON.stringify(body) }));
const webhook = { url: "https://example.com/hook" };

beforeEach(() => {
  mockValues.mockClear();
  mockAuth.mockResolvedValue({ userId: id, organizationId: id, project: { id, name: "P" }, isCliAuth: false });
});

describe("POST /api/notification-providers validation", () => {
  it.each([[{}], [{ name: "   " }], [{ name: 42 }]])("rejects a missing or blank name %j", async (extra) => {
    const response = await post({ type: "webhook", config: webhook, ...extra });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Provider name is required");
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("rejects an over-long name and an oversized config", async () => {
    expect((await post({ type: "webhook", name: "x".repeat(256), config: webhook })).status).toBe(400);
    const big = await post({ type: "webhook", name: "ok", config: { ...webhook, bodyTemplate: "x".repeat(25_000) } });
    expect(big.status).toBe(400);
    expect(mockValues).not.toHaveBeenCalled();
  });

  it.each([null, [], "x"])("rejects a non-object body %j", async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("prefers the top-level name over config.name, which stays the fallback", async () => {
    await post({ type: "webhook", name: "Top", config: { ...webhook, name: "Inner" } });
    expect(mockValues.mock.calls[0][0]).toMatchObject({ name: "Top" });
    mockValues.mockClear();
    await post({ type: "webhook", config: { ...webhook, name: "Inner" } });
    expect(mockValues.mock.calls[0][0]).toMatchObject({ name: "Inner" });
  });

  it("creates a disabled provider when isEnabled is false", async () => {
    const response = await post({ type: "webhook", name: "Ops", isEnabled: false, config: webhook });
    expect(response.status).toBe(201);
    expect(mockValues.mock.calls[0][0]).toMatchObject({ name: "Ops", isEnabled: false });
  });

  it("enables by default and stores an emails array as the comma-separated string", async () => {
    const response = await post({ type: "email", name: "Mail", config: { emails: ["a@b.co", "c@d.io"] } });
    expect(response.status).toBe(201);
    expect(mockValues.mock.calls[0][0]).toMatchObject({ isEnabled: true, config: { emails: "a@b.co,c@d.io" } });
  });

  it.each([[[]], [["notanemail"]]])("rejects invalid emails %j", async (emails) => {
    expect((await post({ type: "email", name: "Mail", config: { emails } })).status).toBe(400);
    expect(mockValues).not.toHaveBeenCalled();
  });
});

describe("POST /api/notification-providers cross-origin and body-size guards", () => {
  const { jsonRequest, declaredOversizeRequest, streamedOversizeRequest, SAME_ORIGIN, CROSS_ORIGIN } =
    jest.requireActual("@/lib/security/request-hardening.spec-helpers") as typeof import("@/lib/security/request-hardening.spec-helpers");
  const body = { type: "webhook", name: "Hook", config: webhook };
  const url = "/api/notification-providers";

  it("refuses a cross-origin cookie session with 403", async () => {
    expect((await POST(jsonRequest(url, "POST", body, { origin: CROSS_ORIGIN }))).status).toBe(403);
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("creates for a same-origin cookie session and for a CLI bearer token from anywhere", async () => {
    expect((await POST(jsonRequest(url, "POST", body, { origin: SAME_ORIGIN }))).status).toBe(201);
    mockAuth.mockResolvedValueOnce({ userId: id, organizationId: id, project: { id, name: "P" }, isCliAuth: true });
    expect((await POST(jsonRequest(url, "POST", body, { origin: CROSS_ORIGIN, authorization: "Bearer sck_live_x" }))).status).toBe(201);
  });

  it.each([["declared", declaredOversizeRequest], ["streamed", streamedOversizeRequest]])(
    "refuses a %s body over 256 KB with 413",
    async (_kind, make) => {
      expect((await POST(make(url, "POST", 256 * 1024 + 1))).status).toBe(413);
      expect(mockValues).not.toHaveBeenCalled();
    },
  );
});
