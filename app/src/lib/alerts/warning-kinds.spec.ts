import { normalizeWarningToggles, warningKindsForMonitorType } from "./warning-kinds";

describe("agent_run_failed", () => {
  it("is offered for synthetic monitors only when the test is an agent test", () => {
    expect(warningKindsForMonitorType("synthetic_test")).toEqual([]);
    expect(warningKindsForMonitorType("synthetic_test", { agentTest: true })).toEqual(["agent_run_failed"]);
    expect(warningKindsForMonitorType("http_request", { agentTest: true })).not.toContain("agent_run_failed");
  });

  it("keeps a bare boolean meaning the AI endpoint preset", () => {
    expect(warningKindsForMonitorType("http_request", true)).toContain("ai_model_changed");
    expect(warningKindsForMonitorType("http_request")).not.toContain("ai_model_changed");
  });

  it("is stored for synthetic monitors and dropped for other types", () => {
    expect(normalizeWarningToggles("synthetic_test", { agent_run_failed: false })).toEqual({ agent_run_failed: false });
    expect(normalizeWarningToggles("http_request", { agent_run_failed: true })).toBeUndefined();
  });
});
