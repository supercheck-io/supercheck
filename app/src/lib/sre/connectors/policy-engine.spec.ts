import { evaluateConnectorPolicy } from "./policy-engine";
import { type ConnectorDefinition, type ConnectorSearchParams } from "./connector-base";

const connector: ConnectorDefinition = {
  id: "connector_1",
  type: "prometheus",
  riskLevel: "low",
  permissionLevel: "read",
  sideEffectLevel: "none",
  surfaces: ["metrics"],
  evidenceTypes: ["metric"],
  requires: ["credentials", "time_window", "service_scope"],
  status: "valid",
  scopedServiceIds: ["service_1"],
  defaultTimeWindowMinutes: 60,
  outputLimits: {
    maxRows: 100,
    maxBytes: 10_000,
    maxSeconds: 10,
  },
};

const params: ConnectorSearchParams = {
  query: "up{service=\"checkout\"}",
  serviceId: "service_1",
  timeWindow: {
    start: new Date("2026-06-21T10:00:00.000Z"),
    end: new Date("2026-06-21T10:30:00.000Z"),
  },
  budget: {
    maxRows: 50,
    maxBytes: 5_000,
    maxSeconds: 5,
    maxCost: 0,
  },
};

describe("evaluateConnectorPolicy", () => {
  it("allows scoped read-only connector queries within time and output budgets", () => {
    const decision = evaluateConnectorPolicy({
      organizationId: "org_1",
      projectId: "project_1",
      connector,
      params,
      actor: { actorType: "agent", investigationRunId: "run_1" },
    });

    expect(decision).toEqual({
      allowed: true,
      effectiveLimits: { maxRows: 50, maxBytes: 5_000, maxSeconds: 5 },
      reason: "Connector query allowed",
    });
  });

  it("denies connectors outside the requested service scope", () => {
    const decision = evaluateConnectorPolicy({
      organizationId: "org_1",
      projectId: "project_1",
      connector,
      params: { ...params, serviceId: "service_2" },
      actor: { actorType: "agent", investigationRunId: "run_1" },
    });

    expect(decision).toMatchObject({ allowed: false, code: "scope_violation" });
  });

  it("denies budgets that exceed connector limits", () => {
    const decision = evaluateConnectorPolicy({
      organizationId: "org_1",
      projectId: "project_1",
      connector,
      params: { ...params, budget: { ...params.budget, maxRows: 101 } },
      actor: { actorType: "agent", investigationRunId: "run_1" },
    });

    expect(decision).toMatchObject({ allowed: false, code: "budget_exceeded" });
  });
});
