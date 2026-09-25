/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/ai/ai-security", () => ({ AuthService: {
  validateUserAccess: jest.fn(), checkRateLimit: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-streaming-service", () => ({ AIStreamingService: {
  generateStreamingResponse: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-prompts", () => ({ AIPromptBuilder: { buildJobAnalyzePrompt: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn() }));
jest.mock("@/lib/services/usage-tracker", () => ({ usageTracker: { consumeAICredit: jest.fn() } }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-proxy", () => ({ getS3FileContent: jest.fn(), getS3FileContentFromUrl: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));

import { POST } from "./route";

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
    getActiveOrganization.mockResolvedValue(null);
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
  });
});
