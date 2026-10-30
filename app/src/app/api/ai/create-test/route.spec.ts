/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/ai/ai-security", () => ({
  AISecurityService: { sanitizeTextOutput: (v: string) => v, sanitizeCodeInput: (v: string) => v },
  AuthService: { checkRateLimit: jest.fn() },
}));
jest.mock("@/lib/ai/ai-streaming-service", () => ({ AIStreamingService: { generateStreamingResponse: jest.fn() } }));
jest.mock("@/lib/ai/ai-prompts", () => ({ AIPromptBuilder: {} }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ getClientIP: jest.fn(() => "127.0.0.1") }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn(async () => ({ user: { id: "user-1" } })) }));
jest.mock("@/lib/services/usage-tracker", () => ({ usageTracker: { consumeAICredit: jest.fn() } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {
  blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn(),
} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));

import { GET, POST } from "./route";
import { usageTracker } from "@/lib/services/usage-tracker";

const { getActiveOrganization } = jest.requireMock("@/lib/session") as { getActiveOrganization: jest.Mock };
const { AIStreamingService } = jest.requireMock("@/lib/ai/ai-streaming-service") as { AIStreamingService: { generateStreamingResponse: jest.Mock } };

const post = (body: object) => POST(new NextRequest("http://localhost/api/ai/create-test", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

describe("AI create-test input bounds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getActiveOrganization.mockResolvedValue({ id: "org-1" });
  });

  it("rejects an oversized current script before any AI call or credit charge", async () => {
    const response = await post({ userRequest: "write a login test", testType: "playwright", currentScript: "x".repeat(50_001) });
    expect(response.status).toBe(400);
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
  });

  it("requires an active organization before any AI call or credit charge", async () => {
    getActiveOrganization.mockResolvedValue(null);
    const response = await post({ userRequest: "write a login test", testType: "playwright" });
    expect(response.status).toBe(400);
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
  });

  it("maps the capitalised rate-limit error from AuthService to 429", async () => {
    const { AuthService } = jest.requireMock("@/lib/ai/ai-security") as { AuthService: { checkRateLimit: jest.Mock } };
    AuthService.checkRateLimit.mockRejectedValueOnce(new Error("Rate limit exceeded. Please try again in 5 seconds."));
    const response = await post({ userRequest: "write a login test", testType: "playwright" });
    expect(response.status).toBe(429);
  });

  it("serves a static health check without calling the provider", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});
