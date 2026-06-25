import crypto from "node:crypto";

export type ConnectorType =
  | "github"
  | "kubernetes"
  | "prometheus"
  | "grafana"
  | "datadog"
  | "splunk"
  | "appdynamics"
  | "newrelic"
  | "sentry"
  | "loki"
  | "elasticsearch"
  | "tempo"
  | "jaeger"
  | "opentelemetry"
  | "aws_cloudwatch"
  | "gcp_monitoring"
  | "azure_monitor"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "redis"
  | "clickhouse"
  | "kafka"
  | "rabbitmq"
  | "gitlab"
  | "confluence"
  | "notion"
  | "slack"
  | "teams"
  | "pagerduty"
  | "opsgenie"
  | "jira"
  | "mcp"
  | "webhook"
  | "supercheck_native";

export type ConnectorRiskLevel = "low" | "medium" | "high" | "critical";
export type ConnectorPermissionLevel = "read";
export type ConnectorSideEffectLevel = "none";
export type ConnectorStatus = "configured" | "valid" | "unreachable" | "missing_credentials" | "disabled";
export type ConnectorSurface = "metrics" | "logs" | "traces" | "deploys" | "code" | "tickets" | "chat" | "infra" | "native";
export type ConnectorEvidenceType = "metric" | "log" | "trace" | "artifact" | "deployment" | "event" | "document" | "topology";
export type ConnectorRequirement = "credentials" | "network" | "service_scope" | "time_window" | "allowlist";

export type ConnectorOutputLimits = {
  maxRows: number;
  maxBytes: number;
  maxSeconds: number;
};

export type ConnectorBudget = ConnectorOutputLimits & {
  maxCost: number;
};

export type ConnectorTimeWindow = {
  start: Date;
  end: Date;
};

export type ConnectorSearchParams = {
  query: string;
  serviceId: string;
  timeWindow: ConnectorTimeWindow;
  budget: ConnectorBudget;
  filters?: Record<string, unknown>;
};

export type ConnectorEvidenceItem = {
  id: string;
  source: ConnectorType | "native";
  sourceUri: string;
  title: string;
  summary: string;
  rawContent?: string;
  evidenceType: ConnectorEvidenceType;
  metadata: {
    timestamp: Date;
    severity?: string;
    confidence?: number;
    tags?: string[];
  };
  citation: {
    connectorId: string;
    query: string;
    resultHash: string;
  };
};

export type ConnectorValidationResult = {
  status: "valid" | "unreachable" | "invalid_credentials" | "policy_blocked";
  message?: string;
  latencyMs?: number;
};

export type ConnectorMetadata = {
  id: string;
  type: ConnectorType;
  displayName: string;
  description: string;
  surfaces: ConnectorSurface[];
  evidenceTypes: ConnectorEvidenceType[];
  requires: ConnectorRequirement[];
};

export type ConnectorDefinition = {
  id: string;
  type: ConnectorType;
  riskLevel: ConnectorRiskLevel;
  permissionLevel: ConnectorPermissionLevel;
  sideEffectLevel: ConnectorSideEffectLevel;
  surfaces: ConnectorSurface[];
  evidenceTypes: ConnectorEvidenceType[];
  requires: ConnectorRequirement[];
  status: ConnectorStatus;
  scopedServiceIds: string[];
  defaultTimeWindowMinutes: number;
  outputLimits: ConnectorOutputLimits;
};

export interface Connector extends ConnectorDefinition {
  search(params: ConnectorSearchParams): Promise<ConnectorEvidenceItem[]>;
  validate(): Promise<ConnectorValidationResult>;
  metadata(): ConnectorMetadata;
}

export const DEFAULT_CONNECTOR_OUTPUT_LIMITS: ConnectorOutputLimits = {
  maxRows: 100,
  maxBytes: 1_048_576,
  maxSeconds: 10,
};

export class ConnectorInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorInvariantError";
  }
}

export function assertReadOnlyConnector(connector: Pick<ConnectorDefinition, "permissionLevel" | "sideEffectLevel">): void {
  if (connector.permissionLevel !== "read") {
    throw new ConnectorInvariantError("SRE connectors must be read-only");
  }

  if (connector.sideEffectLevel !== "none") {
    throw new ConnectorInvariantError("SRE connectors must not have external side effects");
  }
}

export function hashConnectorPayload(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}
