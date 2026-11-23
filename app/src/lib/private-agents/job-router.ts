import {
  hashConnectorPayload,
  type ConnectorDefinition,
  type ConnectorSearchParams,
} from "@/lib/sre/connectors";
import { isPrivateAgentConnectorType } from "@/lib/sre/connectors/connector-capabilities";
import {
  agentSupportsConnectorType,
  isPrivateAgentEligibleForJob,
  type PrivateAgentRecord,
} from "./agent-registry";

export type PrivateAgentRouteRequest = {
  organizationId: string;
  projectId: string;
  connector: ConnectorDefinition & {
    privateAgentId?: string | null;
    endpointUrl?: string | null;
  };
  params: ConnectorSearchParams;
  agents: PrivateAgentRecord[];
  now?: Date;
};

export type PrivateAgentRouteDecision =
  | {
      routed: true;
      jobClass: "sre_connector_query";
      privateAgentId: string;
      idempotencyKey: string;
      jobSpecHash: string;
      jobSpec: PrivateAgentSreConnectorJobSpec;
    }
  | {
      routed: false;
      code:
        | "direct_connector"
        | "private_agent_not_found"
        | "private_agent_unhealthy"
        | "private_agent_unsupported"
        | "private_agent_outdated";
      reason: string;
    };

export type PrivateAgentSreConnectorJobSpec = {
  jobClass: "sre_connector_query";
  organizationId: string;
  projectId: string;
  connectorId: string;
  connectorType: ConnectorDefinition["type"];
  endpointUrl: string | null;
  serviceId: string;
  query: string;
  timeWindow: { start: string; end: string };
  budget: ConnectorSearchParams["budget"];
  filters: Record<string, unknown>;
};

// The key keeps the window length, floors its end to this bucket and adds the bucket the request was made in, so
// identical searches a moment apart share one job while a repeat later (even with the same fixed end) gets a fresh
// one. The executed window is unchanged.
// shortcut: inside one bucket a repeat joins the earlier job even if it failed or ran before a credential rotation;
// shrink the bucket or skip failed jobs on conflict if that matters.
const IDEMPOTENCY_WINDOW_BUCKET_MS = 30_000;

export function sreConnectorJobIdempotencyKey(
  privateAgentId: string,
  jobSpec: PrivateAgentSreConnectorJobSpec,
  issuedAt: Date,
) {
  const start = Date.parse(jobSpec.timeWindow.start);
  const end = Date.parse(jobSpec.timeWindow.end);
  return hashConnectorPayload({
    privateAgentId,
    issuedBucket: Math.floor(issuedAt.getTime() / IDEMPOTENCY_WINDOW_BUCKET_MS),
    jobSpec: {
      ...jobSpec,
      timeWindow: { durationMs: end - start, endBucket: Math.floor(end / IDEMPOTENCY_WINDOW_BUCKET_MS) },
    },
  });
}

export function buildSreConnectorJobSpec(
  request: PrivateAgentRouteRequest,
): PrivateAgentSreConnectorJobSpec {
  return {
    jobClass: "sre_connector_query",
    organizationId: request.organizationId,
    projectId: request.projectId,
    connectorId: request.connector.id,
    connectorType: request.connector.type,
    endpointUrl:
      typeof request.connector.endpointUrl === "string"
        ? request.connector.endpointUrl
        : null,
    serviceId: request.params.serviceId,
    query: request.params.query,
    timeWindow: {
      start: request.params.timeWindow.start.toISOString(),
      end: request.params.timeWindow.end.toISOString(),
    },
    budget: request.params.budget,
    filters: request.params.filters ?? {},
  };
}

export function routeSreConnectorQuery(
  request: PrivateAgentRouteRequest,
): PrivateAgentRouteDecision {
  if (!request.connector.privateAgentId) {
    return {
      routed: false,
      code: "direct_connector",
      reason: "Connector is configured for direct execution",
    };
  }

  if (!isPrivateAgentConnectorType(request.connector.type)) {
    return {
      routed: false,
      code: "private_agent_unsupported",
      reason: `${request.connector.type.replace(/_/g, " ")} connector is not supported by Private Agent execution yet`,
    };
  }

  const agent = request.agents.find(
    (candidate) => candidate.id === request.connector.privateAgentId,
  );
  if (!agent) {
    return {
      routed: false,
      code: "private_agent_not_found",
      reason: "Configured private agent was not found",
    };
  }

  if (
    !isPrivateAgentEligibleForJob(agent, "sre_connector_query", request, {
      now: request.now,
    })
  ) {
    const supportsJob = agent.supportsSreConnectors;
    return {
      routed: false,
      code: supportsJob
        ? "private_agent_unhealthy"
        : "private_agent_unsupported",
      reason: supportsJob
        ? "Configured private agent is not healthy"
        : "Configured private agent does not support SRE connectors",
    };
  }

  if (!agentSupportsConnectorType(agent, request.connector.type)) {
    return {
      routed: false,
      code: "private_agent_outdated",
      reason: `Private Agent "${agent.name}" does not support ${request.connector.type.replace(/_/g, " ")} connectors. Upgrade it to the latest version.`,
    };
  }

  const jobSpec = buildSreConnectorJobSpec(request);
  const jobSpecHash = hashConnectorPayload(jobSpec);

  return {
    routed: true,
    jobClass: "sre_connector_query",
    privateAgentId: agent.id,
    idempotencyKey: sreConnectorJobIdempotencyKey(agent.id, jobSpec, request.now ?? new Date()),
    jobSpecHash,
    jobSpec,
  };
}
