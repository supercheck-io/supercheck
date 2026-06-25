/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreInvestigationAgentEnabled: jest.fn(),
}));

jest.mock("@/sre/lib/investigation-runner", () => ({
  runSreIncidentInvestigation: jest.fn(),
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
    consumeSreInvestigationCredit: jest.fn(),
    SreInvestigationBillingError,
  };
});

import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";
import { isSreInvestigationAgentEnabled } from "@/sre/lib/feature-gates";
import { assertCanStartSreInvestigation, consumeSreInvestigationCredit, SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { runSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { POST } from "./route";

const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;
const mockIsSreInvestigationAgentEnabled = isSreInvestigationAgentEnabled as jest.Mock;
const mockRunSreIncidentInvestigation = runSreIncidentInvestigation as jest.Mock;
const mockAssertCanStartSreInvestigation = assertCanStartSreInvestigation as jest.Mock;
const mockConsumeSreInvestigationCredit = consumeSreInvestigationCredit as jest.Mock;

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod" },
};

describe("SRE investigate API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSreInvestigationAgentEnabled.mockReturnValue(true);
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockAssertCanStartSreInvestigation.mockResolvedValue({ billable: true });
    mockConsumeSreInvestigationCredit.mockResolvedValue({ billed: true, usageEventId: "event-1" });
    mockRunSreIncidentInvestigation.mockResolvedValue({
      success: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
      summary: "Likely dependency latency",
      modelId: "test-model",
      finishReason: "stop",
    });
  });

  it("returns 404 without auth or DB work when disabled", async () => {
    mockIsSreInvestigationAgentEnabled.mockReturnValue(false);

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(404);
    expect(mockRequireProjectContext).not.toHaveBeenCalled();
    expect(mockRunSreIncidentInvestigation).not.toHaveBeenCalled();
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
    expect(mockRunSreIncidentInvestigation).not.toHaveBeenCalled();
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

    expect(response.status).toBe(200);
    expect(mockAssertCanStartSreInvestigation).toHaveBeenCalledWith(context.organizationId);
    expect(mockRunSreIncidentInvestigation).toHaveBeenCalledWith({
      userId: context.userId,
      organizationId: context.organizationId,
      projectId: context.project.id,
      incidentId: "018f0000-0000-7000-8000-000000000005",
      enableLiveConnectors: false,
    });
    expect(mockConsumeSreInvestigationCredit).toHaveBeenCalledWith({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userId: context.userId,
      incidentId: "018f0000-0000-7000-8000-000000000005",
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
      useLiveConnectors: false,
    });
  });

  it("returns payment required when billing preflight blocks investigation", async () => {
    mockAssertCanStartSreInvestigation.mockRejectedValue(new SreInvestigationBillingError("Monthly spending limit reached", "spending_limit"));

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toEqual({ error: "Monthly spending limit reached", code: "spending_limit" });
    expect(mockRunSreIncidentInvestigation).not.toHaveBeenCalled();
    expect(mockConsumeSreInvestigationCredit).not.toHaveBeenCalled();
  });

  it("does not consume usage when investigation fails", async () => {
    mockRunSreIncidentInvestigation.mockResolvedValue({
      success: false,
      status: 500,
      error: "agent failed",
      investigationRunId: "018f0000-0000-7000-8000-000000000004",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/investigate", {
      method: "POST",
      body: JSON.stringify({ incidentId: "018f0000-0000-7000-8000-000000000005" }),
    }));

    expect(response.status).toBe(500);
    expect(mockConsumeSreInvestigationCredit).not.toHaveBeenCalled();
  });
});
