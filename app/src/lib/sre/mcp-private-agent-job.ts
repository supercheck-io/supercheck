import { and, eq, isNull, or } from "drizzle-orm";

import { externalConnectors, privateAgentJobs, privateAgents } from "@/db/schema";
import { routeSreConnectorQuery } from "@/lib/private-agents/job-router";
import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  hashConnectorPayload,
  type ConnectorDefinition,
  type ConnectorOutputLimits,
} from "@/lib/sre/connectors";
import { db } from "@/utils/db";

type ConnectorRow = typeof externalConnectors.$inferSelect;

export type McpJobOperation =
  | { kind: "discover" }
  | {
      kind: "call_tool";
      tool: string;
      arguments: Record<string, unknown>;
      inputSchema: Record<string, unknown>;
    };

export function mcpEndpointUrl(row: Pick<ConnectorRow, "config">) {
  return typeof row.config?.endpointUrl === "string" ? row.config.endpointUrl : null;
}

export function mcpConnectorDefinition(
  row: ConnectorRow,
  scopedServiceIds: string[],
): ConnectorDefinition {
  const limits = row.outputLimits ?? {};
  const pick = (key: keyof ConnectorOutputLimits) =>
    typeof limits[key] === "number" ? (limits[key] as number) : DEFAULT_CONNECTOR_OUTPUT_LIMITS[key];
  return {
    id: row.id,
    type: row.type,
    riskLevel: row.riskLevel,
    permissionLevel: row.permissionLevel,
    sideEffectLevel: row.sideEffectLevel,
    surfaces: [],
    evidenceTypes: [],
    requires: [],
    status: row.status,
    scopedServiceIds,
    defaultTimeWindowMinutes: row.defaultTimeWindowMinutes,
    outputLimits: { maxRows: pick("maxRows"), maxBytes: pick("maxBytes"), maxSeconds: pick("maxSeconds") },
  };
}

/**
 * Queues one MCP operation on the connector's Private Agent. Arguments are
 * already validated against the allowlist by the caller; the agent re-validates.
 */
export async function queueMcpPrivateAgentJob(input: {
  organizationId: string;
  projectId: string;
  connector: ConnectorRow;
  scopedServiceIds: string[];
  serviceId: string;
  query: string;
  operation: McpJobOperation;
  budget: { maxRows: number; maxBytes: number; maxSeconds: number };
  authorizedBy: "user" | "agent";
  userId: string | null;
  policyDecision: unknown;
}) {
  const { connector } = input;
  if (!connector.privateAgentId) {
    throw new Error("MCP connectors require a Private Agent");
  }

  const agent = await db.query.privateAgents.findFirst({
    where: and(
      eq(privateAgents.id, connector.privateAgentId),
      eq(privateAgents.organizationId, input.organizationId),
      or(eq(privateAgents.projectId, input.projectId), isNull(privateAgents.projectId)),
    ),
  });
  if (!agent) throw new Error("Configured Private Agent was not found");

  const now = new Date();
  const route = routeSreConnectorQuery({
    organizationId: input.organizationId,
    projectId: input.projectId,
    connector: {
      ...mcpConnectorDefinition(connector, input.scopedServiceIds),
      privateAgentId: connector.privateAgentId,
      endpointUrl: mcpEndpointUrl(connector),
    },
    params: {
      query: input.query,
      serviceId: input.serviceId,
      timeWindow: { start: new Date(now.getTime() - 60_000), end: now },
      budget: { ...input.budget, maxCost: 0 },
      filters: { mcp: input.operation },
    },
    agents: [agent],
  });
  if (!route.routed) throw new Error(route.reason);

  const [inserted] = await db
    .insert(privateAgentJobs)
    .values({
      organizationId: input.organizationId,
      projectId: input.projectId,
      privateAgentId: route.privateAgentId,
      connectorId: connector.id,
      jobClass: route.jobClass,
      status: "queued",
      authorizedBy: input.authorizedBy,
      authorizedByUserId: input.userId,
      policyDecisionHash: hashConnectorPayload({
        connectorId: connector.id,
        decision: input.policyDecision,
      }),
      jobSpecHash: route.jobSpecHash,
      jobSpec: route.jobSpec,
      idempotencyKey: route.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: privateAgentJobs.id });

  const existing = inserted
    ? null
    : await db.query.privateAgentJobs.findFirst({
        where: and(
          eq(privateAgentJobs.idempotencyKey, route.idempotencyKey),
          eq(privateAgentJobs.organizationId, input.organizationId),
          eq(privateAgentJobs.projectId, input.projectId),
        ),
        columns: { id: true },
      });
  const jobId = inserted?.id ?? existing?.id;
  if (!jobId) throw new Error("Failed to queue Private Agent connector job");

  return { jobId, route, privateAgentId: route.privateAgentId };
}

export function loadMcpJob(input: {
  jobId: string;
  organizationId: string;
  projectId: string;
  privateAgentId: string;
  connectorId: string;
}) {
  return async () =>
    (await db.query.privateAgentJobs.findFirst({
      where: and(
        eq(privateAgentJobs.id, input.jobId),
        eq(privateAgentJobs.organizationId, input.organizationId),
        eq(privateAgentJobs.projectId, input.projectId),
        eq(privateAgentJobs.privateAgentId, input.privateAgentId),
        eq(privateAgentJobs.connectorId, input.connectorId),
      ),
      columns: { status: true, resultHash: true, resultSummary: true, errorCode: true },
    })) ?? null;
}
