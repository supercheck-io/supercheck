/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/ai/ai-security", () => ({ AuthService: {
  validateUserAccess: jest.fn(), checkRateLimit: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-streaming-service", () => ({ AIStreamingService: {
  generateStreamingResponse: jest.fn(),
} }));
jest.mock("@/lib/ai/ai-prompts", () => ({ AIPromptBuilder: { buildMonitorAnalyzePrompt: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn(), requireAuth: jest.fn() }));
jest.mock("@/lib/services/usage-tracker", () => ({ usageTracker: { consumeAICredit: jest.fn(), refundAICredit: jest.fn() } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {
  blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn(),
} }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-proxy", () => ({ getS3FileContent: jest.fn(), getS3FileContentFromUrl: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));

import { POST } from "./route";
import { headers } from "next/headers";
import { usageTracker } from "@/lib/services/usage-tracker";

const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock } };
const { AuthService } = jest.requireMock("@/lib/ai/ai-security") as { AuthService: {
  validateUserAccess: jest.Mock; checkRateLimit: jest.Mock;
} };
const { getActiveOrganization } = jest.requireMock("@/lib/session") as { getActiveOrganization: jest.Mock };
const { hasPermissionForUser, requireAuth } = jest.requireMock("@/lib/rbac/middleware") as { hasPermissionForUser: jest.Mock; requireAuth: jest.Mock };
const { AIStreamingService } = jest.requireMock("@/lib/ai/ai-streaming-service") as { AIStreamingService: {
  generateStreamingResponse: jest.Mock;
} };

const MONITOR_ID = "00000000-0000-4000-8000-000000000001";

function mockMonitor(row: Record<string, unknown>) {
  db.select.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => ({ then: (fn: (rows: unknown[]) => unknown) => Promise.resolve(fn([row])) }) }) }),
  });
}

const post = () =>
  POST(new NextRequest("http://localhost/api/ai/analyze-monitor", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ monitorId: MONITOR_ID }),
  }));

describe("monitor AI analysis project authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuthService.validateUserAccess.mockResolvedValue({ user: { id: "user-1", organizationId: "org-1" }, tier: "free" });
    AuthService.checkRateLimit.mockResolvedValue(undefined);
    getActiveOrganization.mockResolvedValue({ id: "org-1" });
    requireAuth.mockResolvedValue({ userId: "effective-user" });
    // Stop right after the authorization gate so no AI pipeline is needed.
    (usageTracker.consumeAICredit as jest.Mock).mockResolvedValue({ allowed: false, status: 402, reason: "stop" });
  });

  it("keeps the same rate-limit IP when a caller spoofs leftmost XFF", async () => {
    const original = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    mockMonitor({ id: MONITOR_ID, organizationId: "org-1", projectId: "project-9" });
    hasPermissionForUser.mockResolvedValue(true);
    try {
      for (const spoofed of ["6.6.6.6", "7.7.7.7"]) {
        (headers as jest.Mock).mockResolvedValue(new Headers({
          "x-forwarded-for": `${spoofed}, 203.0.113.9, 198.51.100.7`,
        }));
        await post();
      }
      expect(AuthService.checkRateLimit).toHaveBeenCalledTimes(2);
      for (const [input] of AuthService.checkRateLimit.mock.calls) expect(input.ip).toBe("203.0.113.9");
    } finally {
      if (original === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = original;
      (headers as jest.Mock).mockResolvedValue(new Headers());
    }
  });

  it("checks view access against the monitor's own project and lets permitted users continue", async () => {
    mockMonitor({ id: MONITOR_ID, organizationId: "org-1", projectId: "project-9" });
    hasPermissionForUser.mockResolvedValue(true);

    await post();

    expect(hasPermissionForUser).toHaveBeenCalledWith("effective-user", "monitor", "view", {
      organizationId: "org-1", projectId: "project-9",
    });
  });

  it("denies users without project view access before spending credits or calling AI", async () => {
    mockMonitor({ id: MONITOR_ID, organizationId: "org-1", projectId: "project-9" });
    hasPermissionForUser.mockResolvedValue(false);

    const response = await post();

    expect(response.status).toBe(404);
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
  });

  it("denies monitors that have no project or organization", async () => {
    mockMonitor({ id: MONITOR_ID, organizationId: "org-1", projectId: null });

    const response = await post();

    expect(response.status).toBe(404);
    expect(hasPermissionForUser).not.toHaveBeenCalled();
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
  });

  it("still rejects monitors from another organization", async () => {
    mockMonitor({ id: MONITOR_ID, organizationId: "org-2", projectId: "project-9" });

    const response = await post();

    expect(response.status).toBe(404);
    expect(hasPermissionForUser).not.toHaveBeenCalled();
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
  });
});
