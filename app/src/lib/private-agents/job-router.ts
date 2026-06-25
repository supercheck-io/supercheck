import { hashConnectorPayload, type ConnectorDefinition, type ConnectorSearchParams } from "@/lib/sre/connectors";
import {
  isPrivateAgentEligibleForJob,
  type PrivateAgentRecord,
} from "./agent-registry";

export type PrivateAgentRouteRequest = {
  organizationId: string;
  projectId: string;
  connector: ConnectorDefinition & { privateAgentId?: string | null; endpointUrl?: string | null };
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
      code: "direct_connector" | "private_agent_not_found" | "private_agent_unhealthy" | "private_agent_unsupported";
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

export function buildSreConnectorJobSpec(request: PrivateAgentRouteRequest): PrivateAgentSreConnectorJobSpec {
  return {
    jobClass: "sre_connector_query",
    organizationId: request.organizationId,
    projectId: request.projectId,
    connectorId: request.connector.id,
    connectorType: request.connector.type,
    endpointUrl: typeof request.connector.endpointUrl === "string" ? request.connector.endpointUrl : null,
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

export function routeSreConnectorQuery(request: PrivateAgentRouteRequest): PrivateAgentRouteDecision {
  if (!request.connector.privateAgentId) {
    return { routed: false, code: "direct_connector", reason: "Connector is configured for direct execution" };
  }

  const agent = request.agents.find((candidate) => candidate.id === request.connector.privateAgentId);
  if (!agent) {
    return { routed: false, code: "private_agent_not_found", reason: "Configured private agent was not found" };
  }

  if (!isPrivateAgentEligibleForJob(agent, "sre_connector_query", request, { now: request.now })) {
    const supportsJob = agent.supportsSreConnectors;
    return {
      routed: false,
      code: supportsJob ? "private_agent_unhealthy" : "private_agent_unsupported",
      reason: supportsJob ? "Configured private agent is not healthy" : "Configured private agent does not support SRE connectors",
    };
  }

  const jobSpec = buildSreConnectorJobSpec(request);
  const jobSpecHash = hashConnectorPayload(jobSpec);

  return {
    routed: true,
    jobClass: "sre_connector_query",
    privateAgentId: agent.id,
    idempotencyKey: hashConnectorPayload({ privateAgentId: agent.id, jobSpecHash }),
    jobSpecHash,
    jobSpec,
  };
}
