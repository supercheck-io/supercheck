/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/ai/ai-security", () => ({ AuthService: {
  validateUserAccess: jest.fn(), checkRateLimit: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-streaming-service", () => ({ AIStreamingService: {
  generateStreamingResponse: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-prompts", () => ({ AIPromptBuilder: { buildJobAnalyzePrompt: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  AuthError: jest.requireActual("@/lib/auth-context").AuthError,
  authErrorStatus: jest.requireActual("@/lib/auth-context").authErrorStatus,
}));
jest.mock("@/lib/services/usage-tracker", () => ({ usageTracker: { consumeAICredit: jest.fn(), refundAICredit: jest.fn() } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {
  blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn(),
} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-proxy", () => ({ getS3FileContent: jest.fn(), getS3FileContentFromUrl: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));

import { POST } from "./route";
import { AuthError } from "@/lib/auth-context";
import { usageTracker } from "@/lib/services/usage-tracker";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock } };
const { AuthService } = jest.requireMock("@/lib/ai/ai-security") as { AuthService: {
  validateUserAccess: jest.Mock; checkRateLimit: jest.Mock;
} };
const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as { requireAuthContext: jest.Mock };
const { getActiveOrganization } = jest.requireMock("@/lib/session") as { getActiveOrganization: jest.Mock };
const { AIStreamingService } = jest.requireMock("@/lib/ai/ai-streaming-service") as { AIStreamingService: {
  generateStreamingResponse: jest.Mock;
} };

describe("job AI analysis tenant boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuthService.validateUserAccess.mockResolvedValue({ user: { id: "user-1", organizationId: "org-1" }, tier: "free" });
    AuthService.checkRateLimit.mockResolvedValue(undefined);
    requireAuthContext.mockResolvedValue({ organizationId: "org-1", project: { id: "project-1" } });
    getActiveOrganization.mockResolvedValue({ id: "org-1" });
    db.select.mockReturnValue({
      from: () => ({ leftJoin: function () { return this; }, where: () => ({
        limit: async () => [{ id: "run-1", projectId: "foreign-project", jobId: null, logs: "private data" }],
      }) }),
    });
  });

  it("does not analyze a foreign standalone run", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ai/analyze-job", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "00000000-0000-4000-8000-000000000001" }),
    }));
    expect(response.status).toBe(404);
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
  });

  it("rejects a missing billing organization before consuming credits or calling AI", async () => {
    getActiveOrganization.mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/ai/analyze-job", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "00000000-0000-4000-8000-000000000001" }),
    }));
    expect(response.status).toBe(400);
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
  });

  it.each([
    [401, "authentication_required"],
    [403, "forbidden"],
  ] as const)("maps an AuthError %i to reason %s", async (status, reason) => {
    requireAuthContext.mockRejectedValue(new AuthError("denied", status));
    const response = await POST(new NextRequest("http://localhost/api/ai/analyze-job", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "00000000-0000-4000-8000-000000000001" }),
    }));
    expect(response.status).toBe(status);
    expect((await response.json()).reason).toBe(reason);
  });
});

describe("job AI analysis permission", () => {
  it("needs job update permission, not just view, before spending credits", async () => {
    const { checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as { checkPermissionWithContext: jest.Mock };
    AuthService.validateUserAccess.mockResolvedValue({ user: { id: "user-1", organizationId: "org-1" }, tier: "free" });
    requireAuthContext.mockResolvedValue({ organizationId: "org-1", project: { id: "project-1" } });
    checkPermissionWithContext.mockReturnValueOnce(false);
    const response = await POST(new NextRequest("http://localhost/api/ai/analyze-job", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "00000000-0000-4000-8000-000000000001" }),
    }));
    expect(response.status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("job", "update", expect.anything());
    expect(AuthService.checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("job AI analysis input validation", () => {
  const post = (body?: string) =>
    POST(new NextRequest("http://localhost/api/ai/analyze-job", { method: "POST", headers: { "content-type": "application/json" }, body }));

  beforeEach(() => {
    jest.clearAllMocks();
    AuthService.validateUserAccess.mockResolvedValue({ user: { id: "user-1", organizationId: "org-1" }, tier: "free" });
  });

  it.each([[undefined], ["not json"], ["{}"], ["null"], [JSON.stringify({ runId: "zzz", monitorId: "zzz", baselineRun: "zzz", compareRun: "zzz" })]])(
    "answers 400, not 500, for invalid input %p",
    async (body) => {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).reason).toBe("invalid_request");
      expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
    },
  );

  it("answers 401 to an anonymous caller, even with invalid input", async () => {
    AuthService.validateUserAccess.mockRejectedValue(new Error("Authentication required"));
    expect((await post("{}")).status).toBe(401);
  });
});
