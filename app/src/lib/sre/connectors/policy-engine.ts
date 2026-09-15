import {
  assertReadOnlyConnector,
  type ConnectorDefinition,
  type ConnectorOutputLimits,
  type ConnectorSearchParams,
} from "./connector-base";

export type ConnectorActor = {
  actorType: "user" | "agent" | "system";
  userId?: string;
  investigationRunId?: string;
};

export type ConnectorPolicyRequest = {
  organizationId: string;
  projectId: string;
  connector: ConnectorDefinition;
  params: ConnectorSearchParams;
  actor: ConnectorActor;
};

export type ConnectorPolicyDecision =
  | {
      allowed: true;
      effectiveLimits: ConnectorOutputLimits;
      reason: string;
    }
  | {
      allowed: false;
      code:
        | "connector_disabled"
        | "connector_unavailable"
        | "scope_violation"
        | "invalid_time_window"
        | "time_window_exceeded"
        | "budget_exceeded"
        | "read_only_violation";
      reason: string;
    };

export class ConnectorPolicyError extends Error {
  constructor(public readonly decision: Extract<ConnectorPolicyDecision, { allowed: false }>) {
    super(decision.reason);
    this.name = "ConnectorPolicyError";
  }
}

export function evaluateConnectorPolicy(request: ConnectorPolicyRequest): ConnectorPolicyDecision {
  try {
    assertReadOnlyConnector(request.connector);
  } catch (error) {
    return {
      allowed: false,
      code: "read_only_violation",
      reason: error instanceof Error ? error.message : "Connector violates read-only policy",
    };
  }

  if (request.connector.status === "disabled") {
    return { allowed: false, code: "connector_disabled", reason: "Connector is disabled" };
  }

  if (request.connector.status === "unreachable" || request.connector.status === "missing_credentials") {
    return { allowed: false, code: "connector_unavailable", reason: `Connector is ${request.connector.status}` };
  }

  if (
    request.connector.scopedServiceIds.length > 0 &&
    !request.connector.scopedServiceIds.includes(request.params.serviceId)
  ) {
    return { allowed: false, code: "scope_violation", reason: "Connector is not scoped to the requested service" };
  }

  const windowMs = request.params.timeWindow.end.getTime() - request.params.timeWindow.start.getTime();
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return { allowed: false, code: "invalid_time_window", reason: "Connector query time window is invalid" };
  }

  const maxWindowMs = request.connector.defaultTimeWindowMinutes * 60_000;
  if (windowMs > maxWindowMs) {
    return { allowed: false, code: "time_window_exceeded", reason: "Connector query time window exceeds connector policy" };
  }

  if (
    request.params.budget.maxRows > request.connector.outputLimits.maxRows ||
    request.params.budget.maxBytes > request.connector.outputLimits.maxBytes ||
    request.params.budget.maxSeconds > request.connector.outputLimits.maxSeconds
  ) {
    return { allowed: false, code: "budget_exceeded", reason: "Connector query budget exceeds connector limits" };
  }

  return {
    allowed: true,
    effectiveLimits: {
      maxRows: request.params.budget.maxRows,
      maxBytes: request.params.budget.maxBytes,
      maxSeconds: request.params.budget.maxSeconds,
    },
    reason: "Connector query allowed",
  };
}

export function enforceConnectorPolicy(request: ConnectorPolicyRequest): Extract<ConnectorPolicyDecision, { allowed: true }> {
  const decision = evaluateConnectorPolicy(request);
  if (!decision.allowed) {
    throw new ConnectorPolicyError(decision);
  }

  return decision;
}
