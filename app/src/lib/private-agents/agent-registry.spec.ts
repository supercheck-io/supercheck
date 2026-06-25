import { agentSupportsJobClass, getPrivateAgentHealth, isPrivateAgentEligibleForJob, type PrivateAgentRecord } from "./agent-registry";

const agent: PrivateAgentRecord = {
  id: "agent_1",
  organizationId: "org_1",
  projectId: "project_1",
  name: "prod-vpc-agent",
  status: "connected",
  agentMode: "connector_proxy",
  version: "1.0.0",
  region: "us-east",
  networkLabel: "prod-vpc",
  lastHeartbeatAt: new Date("2026-06-21T10:00:00.000Z"),
  lastError: null,
  supportsSreConnectors: true,
  supportsHttpMonitoring: false,
  supportsPlaywright: false,
  supportsK6: false,
  supportsNetworkChecks: false,
};

describe("private agent registry helpers", () => {
  it("marks connected agents with fresh heartbeats as healthy", () => {
    expect(getPrivateAgentHealth(agent, { now: new Date("2026-06-21T10:01:00.000Z") })).toMatchObject({
      healthy: true,
      stale: false,
      lastHeartbeatAgeMs: 60_000,
    });
  });

  it("treats stale heartbeats as ineligible", () => {
    expect(
      isPrivateAgentEligibleForJob(agent, "sre_connector_query", {
        organizationId: "org_1",
        projectId: "project_1",
      }, { now: new Date("2026-06-21T10:02:00.000Z") })
    ).toBe(false);
  });

  it("only enables Step 5 connector jobs for connector-capable agents", () => {
    expect(agentSupportsJobClass(agent, "sre_connector_query")).toBe(true);
    expect(agentSupportsJobClass(agent, "playwright_run")).toBe(false);
  });
});
