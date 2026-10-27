export type PrivateAgentStatus = "pending" | "connected" | "disconnected" | "unhealthy" | "disabled";
export type PrivateAgentMode = "connector_proxy" | "execution_worker" | "hybrid";
export type PrivateAgentJobClass = "sre_connector_query" | "http_monitor_check" | "playwright_run" | "k6_run" | "network_check";

export type PrivateAgentCapabilities = {
  supportsSreConnectors: boolean;
  supportsHttpMonitoring: boolean;
  supportsPlaywright: boolean;
  supportsK6: boolean;
  supportsNetworkChecks: boolean;
};

export type PrivateAgentRecord = PrivateAgentCapabilities & {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  status: PrivateAgentStatus;
  agentMode: PrivateAgentMode;
  version: string | null;
  region: string | null;
  networkLabel: string | null;
  lastHeartbeatAt: Date | null;
  lastError: string | null;
  metadata?: unknown;
};

export type PrivateAgentHealth = {
  status: PrivateAgentStatus;
  healthy: boolean;
  stale: boolean;
  lastHeartbeatAgeMs: number | null;
};

const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 90_000;

export function getPrivateAgentHealth(
  agent: Pick<PrivateAgentRecord, "status" | "lastHeartbeatAt">,
  options: { now?: Date; staleAfterMs?: number } = {}
): PrivateAgentHealth {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_HEARTBEAT_STALE_AFTER_MS;
  const lastHeartbeatAgeMs = agent.lastHeartbeatAt ? now.getTime() - agent.lastHeartbeatAt.getTime() : null;
  const stale = lastHeartbeatAgeMs === null || lastHeartbeatAgeMs > staleAfterMs;
  const healthy = agent.status === "connected" && !stale;

  return {
    status: agent.status,
    healthy,
    stale,
    lastHeartbeatAgeMs,
  };
}

export function agentSupportsJobClass(agent: PrivateAgentCapabilities, jobClass: PrivateAgentJobClass): boolean {
  switch (jobClass) {
    case "sre_connector_query":
      return agent.supportsSreConnectors;
    case "http_monitor_check":
      return agent.supportsHttpMonitoring;
    case "playwright_run":
      return agent.supportsPlaywright;
    case "k6_run":
      return agent.supportsK6;
    case "network_check":
      return agent.supportsNetworkChecks;
  }
}

export function isPrivateAgentEligibleForJob(
  agent: PrivateAgentRecord,
  jobClass: PrivateAgentJobClass,
  scope: { organizationId: string; projectId: string },
  options: { now?: Date; staleAfterMs?: number } = {}
): boolean {
  if (agent.organizationId !== scope.organizationId) {
    return false;
  }

  if (agent.projectId && agent.projectId !== scope.projectId) {
    return false;
  }

  return getPrivateAgentHealth(agent, options).healthy && agentSupportsJobClass(agent, jobClass);
}

// Every agent supported these before agents reported their own list; an agent that reports none is assumed to be that old.
const LEGACY_AGENT_CONNECTOR_TYPES: readonly string[] = [
  "github", "prometheus", "grafana", "kubernetes", "sentry",
  "datadog", "loki", "elasticsearch", "tempo", "aws_cloudwatch",
];

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
}

/** The connector types the agent last reported, or null for agents that predate reporting. */
export function reportedConnectorTypes(metadata: unknown): string[] | null {
  const types = metadataObject(metadata).sreConnectorTypes;
  return Array.isArray(types) && types.every((type) => typeof type === "string") ? types : null;
}

/** Stores (or clears, for an agent that stopped reporting) the agent's connector types without touching other metadata. */
export function withReportedConnectorTypes(metadata: unknown, types: string[] | undefined): Record<string, unknown> {
  const { sreConnectorTypes: _previous, ...rest } = metadataObject(metadata);
  return types ? { ...rest, sreConnectorTypes: types } : rest;
}

export function agentSupportsConnectorType(agent: Pick<PrivateAgentRecord, "metadata">, connectorType: string): boolean {
  return (reportedConnectorTypes(agent.metadata) ?? LEGACY_AGENT_CONNECTOR_TYPES).includes(connectorType);
}
