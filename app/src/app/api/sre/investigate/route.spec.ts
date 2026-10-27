/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn((error: unknown) => error instanceof Error && error.message === "Authentication required"),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreInvestigationRateLimit: jest.fn(),
}));

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreInvestigationAgentEnabled: jest.fn(),
}));

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  const afterTasks: Promise<unknown>[] = [];
  (globalThis as { __sreInvestigateAfterTasks?: Promise<unknown>[] }).__sreInvestigateAfterTasks =
    afterTasks;
  return {
    ...actual,
    after: (task: () => unknown) => {
      const result = typeof task === "function" ? task() : task;
      if (result && typeof (result as Promise<unknown>).then === "function") {
        afterTasks.push(result as Promise<unknown>);
      }
    },
  };
});

function getAfterTasks() {
  return (
    (globalThis as { __sreInvestigateAfterTasks?: Promise<unknown>[] })
      .__sreInvestigateAfterTasks ?? []
  );
}

async function flushAfterTasks() {
  const tasks = getAfterTasks();
  await Promise.all(tasks);
  tasks.length = 0;
}

jest.mock("@/sre/lib/investigation-runner", () => ({
  startSreIncidentInvestigation: jest.fn(),
  completeSreIncidentInvestigation: jest.fn(),
}));

const mockDailyLimit = jest.fn();
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({
  sreDailyTokenLimitResponse: (...args: unknown[]) => mockDailyLimit(...args),
}));

jest.mock("@/lib/sre/investigation-billing", () => {
  class SreInvestigationBillingError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
      this.name = "SreInvestigationBillingError";
    }
  }

  return {
    assertCanStartSreInvestigation: jest.fn(),
    SreInvestigationBillingError,
  };
});

import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreInvestigationRateLimit } from "@/lib/sre/sre-rate-limiter";
import { requireAuthContext } from "@/lib/auth-context";
import { isSreInvestigationAgentEnabled } from "@/sre/lib/feature-gates";
import { assertCanStartSreInvestigation, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { completeSreIncidentInvestigation, startSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { POST } from "./route";

const mockRequireProjectContext = requireAuthContext as jest.Mock;
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;
const mockCheckSreInvestigationRateLimit = checkSreInvestigationRateLimit as jest.Mock;
const mockIsSreInvestigationAgentEnabled = isSreInvestigationAgentEnabled as jest.Mock;
const mockStartSreIncidentInvestigation = startSreIncidentInvestigation as jest.Mock;
const mockCompleteSreIncidentInvestigation = completeSreIncidentInvestigation as jest.Mock;
const mockAssertCanStartSreInvestigation = assertCanStartSreInvestigation as jest.Mock;

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod" },
};

describe("SRE investigate API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAfterTasks().length = 0;
    mockDailyLimit.mockResolvedValue(null);
    mockIsSreInvestigationAgentEnabled.mockReturnValue(true);
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockCheckSreInvestigationRateLimit.mockResolvedValue({ allowed: true });
    mockAssertCanStartSreInvestigation.mockResolvedValue({ billable: true });
    mockStartSreIncidentInvestigation.mockResolvedValue({
      success: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
      incident: { id: "018f0000-0000-7000-8000-000000000005" },
    });
    mockCompleteSreIncidentInvestigation.mockResolvedValue({
      success: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
      summary: "Likely dependency latency",
      modelId: "test-model",
      finishReason: "stop",
    });
  });

  it("returns 503 without DB work when disabled for an authenticated caller", async () => {
    mockIsSreInvestigationAgentEnabled.mockReturnValue(false);

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "SRE investigation is not enabled",
      code: "feature_disabled",
      enabledBy: "SRE_ENABLED",
    });
    expect(mockRequireProjectContext).toHaveBeenCalled();
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before disclosing the feature flag", async () => {
    mockIsSreInvestigationAgentEnabled.mockReturnValue(false);
    mockRequireProjectContext.mockRejectedValueOnce(new Error("Authentication required"));

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(401);
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("requires incident and investigation permissions", async () => {
    mockCheckPermissionWithContext
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(403);
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("runs investigation and enables live connectors only with connector permission", async () => {
    mockCheckPermissionWithContext
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005", useLiveConnectors: true }),
    }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      accepted: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
    });
    expect(mockAssertCanStartSreInvestigation).toHaveBeenCalledWith(context.organizationId);
    expect(mockStartSreIncidentInvestigation).toHaveBeenCalledWith({
      userId: context.userId,
      organizationId: context.organizationId,
      projectId: context.project.id,
      incidentId: "018f0000-0000-7000-8000-000000000005",
      enableLiveConnectors: false,
      guidance: undefined,
    });
    await flushAfterTasks();
    expect(mockCompleteSreIncidentInvestigation).toHaveBeenCalledWith(
      "018f0000-0000-7000-8000-000000000004",
      { id: "018f0000-0000-7000-8000-000000000005" },
      {
        userId: context.userId,
        organizationId: context.organizationId,
        projectId: context.project.id,
        incidentId: "018f0000-0000-7000-8000-000000000005",
        enableLiveConnectors: false,
        guidance: undefined,
      },
    );
  });

  it("normalizes the optional re-run guidance note and rejects oversized notes", async () => {
    mockCheckPermissionWithContext.mockReturnValue(true);
    const incidentId = "018f0000-0000-7000-8000-000000000005";
    const post = (guidance: string) =>
      POST(new NextRequest("http://localhost/api/sre/investigate", {
        method: "POST",
        body: JSON.stringify({ incidentId, guidance }),
      }));
    expect((await post("x".repeat(1001))).status).toBe(400);
    expect((await post("check the\n CDN")).status).toBe(202);
    expect(mockStartSreIncidentInvestigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ guidance: "check the CDN" }),
    );
  });

  it("returns the daily usage limit response before starting a run", async () => {
    mockDailyLimit.mockResolvedValueOnce(Response.json({ error: "limit", code: "daily_ai_limit" }, { status: 429 }));

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(429);
    expect(mockDailyLimit).toHaveBeenCalledWith(expect.any(String));
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("returns payment required when billing preflight blocks investigation", async () => {
    mockAssertCanStartSreInvestigation.mockRejectedValue(new SreInvestigationBillingError("Monthly spending limit reached", "spending_limit"));

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toEqual({ error: "Your organization has reached its usage limit. Raise the limit or try again later.", code: "spending_limit" });
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
    expect(mockCompleteSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("fails closed when the investigation rate limiter is unavailable", async () => {
    mockCheckSreInvestigationRateLimit.mockResolvedValue({
      allowed: false,
      unavailable: true,
      remaining: 0,
      resetTime: Date.now() + 300_000,
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(mockAssertCanStartSreInvestigation).not.toHaveBeenCalled();
    expect(mockStartSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("does not consume usage when investigation start fails", async () => {
    mockStartSreIncidentInvestigation.mockResolvedValue({
      success: false,
      status: 500,
      error: "agent failed",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(500);
    expect(mockCompleteSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("returns conflict when the incident already has a running investigation", async () => {
    mockStartSreIncidentInvestigation.mockResolvedValue({
      success: false,
      status: 409,
      error: "An investigation is already running for this incident",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "An investigation is already running for this incident",
    });
    expect(mockCompleteSreIncidentInvestigation).not.toHaveBeenCalled();
  });

  it("still accepts the run when later execution fails", async () => {
    mockCompleteSreIncidentInvestigation.mockResolvedValue({
      success: false,
      status: 502,
      error: "SRE investigation failed",
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      accepted: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
    });
    await flushAfterTasks();
    expect(mockCompleteSreIncidentInvestigation).toHaveBeenCalled();
  });
});
