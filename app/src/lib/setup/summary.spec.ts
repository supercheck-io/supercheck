/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/ai/ai-provider", () => ({ isAIProviderConfigured: () => false }));
jest.mock("@/lib/setup/setup-state", () => ({
  getSetupState: jest.fn(async () => ({ status: "not_started", statusPageOptOut: false })),
  getChecklistCounts: jest.fn(),
}));
import { getChecklistCounts, getSetupState } from "@/lib/setup/setup-state";
import { getSetupSummary, projectIsEmpty } from "./summary";

const counts = (n: number) => ({
  monitors: n, heartbeatMonitors: 0, notificationProviders: 0, statusPages: 0, requirements: 0, tests: 0, jobs: 0,
  connectorsOrAgents: 0, services: 0, membersAndInvites: 1, cliTokens: 0, pushDevices: 0,
});

describe("getSetupSummary", () => {
  it("reports an empty project and its checklist progress", async () => {
    (getChecklistCounts as jest.Mock).mockResolvedValue(counts(0));
    const summary = await getSetupSummary("o1", "p1", "u1");
    expect(getSetupState).toHaveBeenCalledWith("o1", "p1", "u1");
    expect(getChecklistCounts).toHaveBeenCalledWith("o1", "p1");
    expect(summary).toMatchObject({ status: "not_started", projectEmpty: true });
    expect(summary.total).toBeGreaterThan(0);
  });

  it("is not empty once any resource exists", () => {
    expect(projectIsEmpty(counts(1))).toBe(false);
    expect(projectIsEmpty(counts(0))).toBe(true);
  });
});
