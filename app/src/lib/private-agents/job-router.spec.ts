import { type ConnectorDefinition, type ConnectorSearchParams } from "@/lib/sre/connectors";
import { type PrivateAgentRecord } from "./agent-registry";
import { routeSreConnectorQuery } from "./job-router";

const connector: ConnectorDefinition & { privateAgentId?: string | null; endpointUrl?: string | null } = {
  id: "connector_1",
  type: "prometheus",
  riskLevel: "low",
  permissionLevel: "read",
  sideEffectLevel: "none",
  surfaces: ["metrics"],
  evidenceTypes: ["metric"],
  requires: ["credentials", "network"],
  status: "valid",
  scopedServiceIds: ["service_1"],
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 100, maxBytes: 10_000, maxSeconds: 10 },
  privateAgentId: "agent_1",
  endpointUrl: "https://prometheus.internal",
};

const params: ConnectorSearchParams = {
  query: "up",
  serviceId: "service_1",
  timeWindow: {
    start: new Date("2026-06-21T10:00:00.000Z"),
    end: new Date("2026-06-21T10:10:00.000Z"),
  },
  budget: { maxRows: 10, maxBytes: 1_000, maxSeconds: 5, maxCost: 0 },
};

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
  lastHeartbeatAt: new Date("2026-06-21T10:09:30.000Z"),
  lastError: null,
  supportsSreConnectors: true,
  supportsHttpMonitoring: false,
  supportsPlaywright: false,
  supportsK6: false,
  supportsNetworkChecks: false,
};

describe("routeSreConnectorQuery", () => {
  it("routes private-network connector queries to healthy private agents", () => {
    const decision = routeSreConnectorQuery({
      organizationId: "org_1",
      projectId: "project_1",
      connector,
      params,
      agents: [agent],
      now: new Date("2026-06-21T10:10:00.000Z"),
    });

    expect(decision).toMatchObject({
      routed: true,
      jobClass: "sre_connector_query",
      privateAgentId: "agent_1",
    });

    if (decision.routed) {
      expect(decision.idempotencyKey).toHaveLength(64);
      expect(decision.jobSpecHash).toHaveLength(64);
      expect(decision.jobSpec).toMatchObject({
        jobClass: "sre_connector_query",
        connectorId: "connector_1",
        connectorType: "prometheus",
        endpointUrl: "https://prometheus.internal",
        serviceId: "service_1",
        query: "up",
      });
      expect(JSON.stringify(decision.jobSpec)).not.toContain("secret");
    }
  });

  it("uses direct execution when no private agent is configured", () => {
    const decision = routeSreConnectorQuery({
      organizationId: "org_1",
      projectId: "project_1",
      connector: { ...connector, privateAgentId: null },
      params,
      agents: [agent],
    });

    expect(decision).toEqual({
      routed: false,
      code: "direct_connector",
      reason: "Connector is configured for direct execution",
    });
  });

  it("rejects stale private agents", () => {
    const decision = routeSreConnectorQuery({
      organizationId: "org_1",
      projectId: "project_1",
      connector,
      params,
      agents: [agent],
      now: new Date("2026-06-21T10:20:00.000Z"),
    });

    expect(decision).toMatchObject({ routed: false, code: "private_agent_unhealthy" });
  });
});
