jest.mock("@/sre/lib/feature-gates", () => ({
  isSreAutomaticTriageEnabled: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/sre/lib/triage-runner", () => ({
  runSreIncidentTriage: jest.fn(),
}));

import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { isSreAutomaticTriageEnabled } from "@/sre/lib/feature-gates";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { maybeRunAutomaticSreTriage } from "./triage-automation";

const mockIsSreAutomaticTriageEnabled = isSreAutomaticTriageEnabled as jest.Mock;
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;
const mockRunSreIncidentTriage = runSreIncidentTriage as jest.Mock;

const input = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", userRole: "project_admin" },
  incidentId: "018f0000-0000-7000-8000-000000000004",
  existingIncident: false,
  alertStatus: "firing" as const,
};

describe("maybeRunAutomaticSreTriage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSreAutomaticTriageEnabled.mockReturnValue(true);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockRunSreIncidentTriage.mockResolvedValue({
      success: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000005",
      summary: "Likely dependency latency",
      modelId: "test-model",
      finishReason: "stop",
    });
  });

  it("skips automatic triage when the auto gate is disabled", async () => {
    mockIsSreAutomaticTriageEnabled.mockReturnValue(false);

    const result = await maybeRunAutomaticSreTriage(input);

    expect(result).toEqual({ attempted: false, reason: "disabled" });
    expect(mockCheckPermissionWithContext).not.toHaveBeenCalled();
    expect(mockRunSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("skips automatic triage for existing incidents", async () => {
    const result = await maybeRunAutomaticSreTriage({ ...input, existingIncident: true });

    expect(result).toEqual({ attempted: false, reason: "existing_incident" });
    expect(mockRunSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("skips automatic triage for resolved alerts", async () => {
    const result = await maybeRunAutomaticSreTriage({ ...input, alertStatus: "resolved" });

    expect(result).toEqual({ attempted: false, reason: "resolved_alert" });
    expect(mockRunSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("skips automatic triage without incident or investigation permissions", async () => {
    mockCheckPermissionWithContext
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await maybeRunAutomaticSreTriage(input);

    expect(result).toEqual({ attempted: false, reason: "insufficient_permissions" });
    expect(mockRunSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("runs triage for new firing incidents when enabled and authorized", async () => {
    const result = await maybeRunAutomaticSreTriage(input);

    expect(result).toEqual({
      attempted: true,
      success: true,
      investigationRunId: "018f0000-0000-7000-8000-000000000005",
      summary: "Likely dependency latency",
      modelId: "test-model",
      finishReason: "stop",
    });
    expect(mockRunSreIncidentTriage).toHaveBeenCalledWith({
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.project.id,
      incidentId: input.incidentId,
    });
  });

  it("returns a bounded failure when automatic triage throws", async () => {
    mockRunSreIncidentTriage.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await maybeRunAutomaticSreTriage(input);

    expect(result).toEqual({ attempted: true, success: false, status: 502, error: "SRE triage failed" });
  });
});
