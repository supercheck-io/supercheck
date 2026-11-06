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
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({ userId: id, organizationId: id, project: { id, name: "P" } }),
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

beforeEach(() => mockValues.mockClear());

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
