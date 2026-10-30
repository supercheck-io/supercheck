/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/api-key-rate-limiter", () => ({ apiKeyRateLimiter: { checkAndIncrement: jest.fn() }, createRateLimitHeaders: jest.fn(() => ({})) }));
jest.mock("@/lib/email-renderer", () => ({ renderTestEmail: jest.fn(async () => ({ subject: "s", text: "t", html: "h" })) }));
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: jest.fn() } }));
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({ fetchPublicEndpoint: jest.fn() }));
import { POST } from "./route";
import { db } from "@/utils/db";
import { requireAuthContext } from "@/lib/auth-context";
import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";
import { EmailService } from "@/lib/email-service";

const send = jest.fn();
const post = (emails: string) =>
  POST(new NextRequest("http://localhost/api/notification-providers/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "email", config: { emails } }),
  }));
// The membership/own-address lookup resolves to the addresses the caller may target.
const allowed = (emails: string[]) =>
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: async () => emails.map((email) => ({ email })) }) }) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: "org-1" });
  (apiKeyRateLimiter.checkAndIncrement as jest.Mock).mockResolvedValue({ allowed: true, remaining: 4, limit: 5, resetAt: new Date() });
  send.mockResolvedValue({ sentCount: 1, errors: {}, failedAddresses: [] });
  (EmailService.getInstance as jest.Mock).mockReturnValue({ sendEmailToMultiple: send });
});

describe("email test connection", () => {
  it("sends to org members or the caller", async () => {
    allowed(["me@example.com"]);
    expect((await post("me@example.com")).status).toBe(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ recipients: ["me@example.com"] }));
  });

  it("deduplicates repeated recipients so one request sends one mail per address", async () => {
    allowed(["me@example.com"]);
    await post("me@example.com, ME@example.com, me@example.com");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ recipients: ["me@example.com"] }));
  });

  it("refuses arbitrary outside recipients without sending", async () => {
    allowed(["me@example.com"]);
    expect((await post("me@example.com, victim@elsewhere.com")).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    allowed(["me@example.com"]);
    (apiKeyRateLimiter.checkAndIncrement as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, limit: 5, resetAt: new Date(), retryAfter: 30 });
    expect((await post("me@example.com")).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("non-email test connection", () => {
  it("is rate limited per user before any outbound request", async () => {
    const { fetchPublicEndpoint } = jest.requireMock("@/lib/sre/connectors/pinned-fetch") as { fetchPublicEndpoint: jest.Mock };
    (apiKeyRateLimiter.checkAndIncrement as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, limit: 20, resetAt: new Date(), retryAfter: 30 });
    const res = await POST(new NextRequest("http://localhost/api/notification-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "slack", config: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } }),
    }));
    expect(res.status).toBe(429);
    expect(apiKeyRateLimiter.checkAndIncrement).toHaveBeenCalledWith("notification-test-other:u1", expect.objectContaining({ maxRequests: 20 }));
    expect(fetchPublicEndpoint).not.toHaveBeenCalled();
  });
});
