import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";

import {
  externalConnectorCredentials,
  externalConnectors,
  externalConnectorServices,
  privateAgentJobs,
  privateAgents,
  diagnosticQueries,
  sreEvidenceItems,
  sreIncidents,
  sreInvestigationToolCalls,
} from "@/db/schema";
import { routeSreConnectorQuery } from "@/lib/private-agents/job-router";
import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  assertEndpointAllowedForExecution,
  createDirectConnector,
  decryptConnectorCredential,
  enforceConnectorPolicy,
  hashConnectorPayload,
  redactConnectorText,
  renderDiagnosticQueryTemplate,
  sanitizeConnectorEvidence,
  type ConnectorCredentialValue,
  type ConnectorDefinition,
  type ConnectorEvidenceItem,
} from "@/lib/sre/connectors";
import { db } from "@/utils/db";

const MAX_TOOL_ROWS = 10;
const MAX_TIME_WINDOW_MINUTES = 6 * 60;
const supportedLiveConnectorTypes = ["github", "kubernetes", "prometheus", "grafana", "sentry", "datadog", "loki", "elasticsearch", "tempo", "aws_cloudwatch"] as const;
type SupportedLiveConnectorType = (typeof supportedLiveConnectorTypes)[number];

const connectorSearchInputSchema = z.object({
  connectorId: z.string().uuid(),
  query: z.string().trim().min(1).max(500),
  timeWindowMinutes: z.number().int().min(1).max(MAX_TIME_WINDOW_MINUTES).optional().default(60),
  maxRows: z.number().int().min(1).max(MAX_TOOL_ROWS).optional().default(5),
  maxBytes: z.number().int().min(1024).max(256_000).optional().default(256_000),
  maxSeconds: z.number().int().min(1).max(15).optional().default(15),
});

const diagnosticQueryInputSchema = z.object({
  queryId: z.string().uuid(),
  parameters: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional().default({}),
  timeWindowMinutes: z.number().int().min(1).max(MAX_TIME_WINDOW_MINUTES).optional().default(60),
});

export type SreConnectorToolScope = {
  organizationId: string;
  projectId: string;
  incidentId: string;
  userId?: string | null;
  investigationRunId?: string | null;
};

type ConnectorRow = typeof externalConnectors.$inferSelect;

function credentialSecret(value: ConnectorCredentialValue | null) {
  const secret = value?.secret;
  return typeof secret === "string" && secret.trim() ? secret.trim() : null;
}

function credentialString(value: ConnectorCredentialValue | null, keys: string[]) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function directConnectorCredential(value: ConnectorCredentialValue | null) {
  if (!value) return null;

  return {
    secret: credentialSecret(value),
    apiKey: credentialString(value, ["apiKey", "api_key", "accessKeyId", "access_key_id", "secret"]),
    applicationKey: credentialString(value, ["applicationKey", "application_key", "appKey", "app_key"]),
    sessionToken: credentialString(value, ["sessionToken", "session_token", "awsSessionToken", "aws_session_token"]),
    region: credentialString(value, ["region", "awsRegion", "aws_region"]),
  };
}

function normalizeOutputLimits(value: Record<string, unknown> | null) {
  return {
    maxRows: typeof value?.maxRows === "number" ? value.maxRows : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxRows,
    maxBytes: typeof value?.maxBytes === "number" ? value.maxBytes : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxBytes,
    maxSeconds: typeof value?.maxSeconds === "number" ? value.maxSeconds : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxSeconds,
  };
}

function buildConnectorDefinition(row: ConnectorRow, scopedServiceIds: string[]): ConnectorDefinition {
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
    outputLimits: normalizeOutputLimits(row.outputLimits),
  };
}

function endpointUrl(row: ConnectorRow) {
  return typeof row.config?.endpointUrl === "string" ? row.config.endpointUrl : null;
}

async function getIncidentPrimaryService(scope: SreConnectorToolScope) {
  const incident = await db.query.sreIncidents.findFirst({
    where: and(
      eq(sreIncidents.id, scope.incidentId),
      eq(sreIncidents.organizationId, scope.organizationId),
      eq(sreIncidents.projectId, scope.projectId)
    ),
    columns: { id: true, primaryServiceId: true },
  });

  if (!incident) {
    throw new Error("Incident not found or access denied");
  }

  if (!incident.primaryServiceId) {
    throw new Error("Incident has no primary service; live connector tools require service scope");
  }

  return incident.primaryServiceId;
}

async function getConnectorScopedServiceIds(connectorId: string, scope: SreConnectorToolScope) {
  const rows = await db
    .select({ serviceId: externalConnectorServices.serviceId })
    .from(externalConnectorServices)
    .where(
      and(
        eq(externalConnectorServices.organizationId, scope.organizationId),
        eq(externalConnectorServices.projectId, scope.projectId),
        eq(externalConnectorServices.connectorId, connectorId)
      )
    );

  return rows.map((row) => row.serviceId);
}

async function loadIncidentConnectors(scope: SreConnectorToolScope) {
  const primaryServiceId = await getIncidentPrimaryService(scope);
  const rows = await db
    .select({ connector: externalConnectors })
    .from(externalConnectors)
    .where(
      and(
        eq(externalConnectors.organizationId, scope.organizationId),
        or(eq(externalConnectors.projectId, scope.projectId), isNull(externalConnectors.projectId)),
        inArray(externalConnectors.type, supportedLiveConnectorTypes),
        inArray(externalConnectors.status, ["configured", "valid"])
      )
    )
    .orderBy(desc(externalConnectors.updatedAt));

  const connectors = await Promise.all(
    rows.map(async (row) => {
      const scopedServiceIds = await getConnectorScopedServiceIds(row.connector.id, scope);
      return { row: row.connector, scopedServiceIds };
    })
  );

  return {
    primaryServiceId,
    connectors: connectors.filter((entry) => entry.scopedServiceIds.length === 0 || entry.scopedServiceIds.includes(primaryServiceId)),
  };
}

function summarizeEvidenceItem(row: typeof sreEvidenceItems.$inferSelect) {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceUri: row.sourceUri,
    title: row.title,
    summary: row.summary,
    evidenceType: row.evidenceType,
    observedAt: row.observedAt?.toISOString() ?? null,
    resultHash: row.citationResultHash,
  };
}

function evidenceInsertValue(scope: SreConnectorToolScope, item: ConnectorEvidenceItem) {
  if (!supportedLiveConnectorTypes.includes(item.source as SupportedLiveConnectorType)) {
    throw new Error(`Unsupported connector evidence source: ${item.source}`);
  }

  return {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    incidentId: scope.incidentId,
    investigationRunId: scope.investigationRunId ?? null,
    sourceType: item.source as SupportedLiveConnectorType,
    sourceConnectorId: item.citation.connectorId,
    sourceUri: item.sourceUri.slice(0, 1000),
    title: item.title.slice(0, 500),
    summary: item.summary,
    rawContentExcerpt: item.rawContent ? item.rawContent.slice(0, 4000) : null,
    evidenceType: item.evidenceType,
    severity: item.metadata.severity ?? null,
    confidence: typeof item.metadata.confidence === "number" ? item.metadata.confidence.toFixed(4) : null,
    tags: { values: item.metadata.tags ?? [] },
    metadata: {
      connectorEvidenceId: item.id,
      source: item.source,
    },
    citationQuery: item.citation.query,
    citationResultHash: item.citation.resultHash,
    observedAt: item.metadata.timestamp,
    createdAt: new Date(),
  };
}

export async function listIncidentLiveConnectors(scope: SreConnectorToolScope) {
  const { primaryServiceId, connectors } = await loadIncidentConnectors(scope);

  return {
    primaryServiceId,
    connectors: connectors.slice(0, 25).map(({ row, scopedServiceIds }) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      executionMode: row.privateAgentId ? "private_agent" : "direct",
      scopedToPrimaryService: scopedServiceIds.includes(primaryServiceId),
      defaultTimeWindowMinutes: row.defaultTimeWindowMinutes,
      outputLimits: normalizeOutputLimits(row.outputLimits),
    })),
  };
}

export async function searchIncidentLiveConnectorEvidence(
  scope: SreConnectorToolScope,
  input: z.infer<typeof connectorSearchInputSchema>
) {
  const startedAt = Date.now();
  const { primaryServiceId, connectors } = await loadIncidentConnectors(scope);
  const selected = connectors.find((entry) => entry.row.id === input.connectorId);

  if (!selected) {
    throw new Error("Connector not found, unavailable, or not scoped to the incident service");
  }

  const connector = selected.row;
  const outputLimits = normalizeOutputLimits(connector.outputLimits);
  const now = new Date();
  const params = {
    query: input.query,
    serviceId: primaryServiceId,
    timeWindow: {
      start: new Date(now.getTime() - input.timeWindowMinutes * 60_000),
      end: now,
    },
    budget: {
      maxRows: Math.min(outputLimits.maxRows, input.maxRows, MAX_TOOL_ROWS),
      maxBytes: Math.min(outputLimits.maxBytes, input.maxBytes, 256_000),
      maxSeconds: Math.min(outputLimits.maxSeconds, input.maxSeconds, 15),
      maxCost: 0,
    },
  };
  const definition = buildConnectorDefinition(connector, selected.scopedServiceIds);
  const policyDecision = enforceConnectorPolicy({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    connector: definition,
    params,
    actor: { actorType: "agent", userId: scope.userId ?? undefined, investigationRunId: scope.investigationRunId ?? undefined },
  });
  const connectorEndpointUrl = endpointUrl(connector);
  await assertEndpointAllowedForExecution(connectorEndpointUrl, Boolean(connector.privateAgentId));

  if (connector.privateAgentId) {
    const agent = await db.query.privateAgents.findFirst({
      where: and(
        eq(privateAgents.id, connector.privateAgentId),
        eq(privateAgents.organizationId, scope.organizationId),
        or(eq(privateAgents.projectId, scope.projectId), isNull(privateAgents.projectId))
      ),
    });

    if (!agent) {
      throw new Error("Configured Private Agent was not found");
    }

    const route = routeSreConnectorQuery({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      connector: { ...definition, privateAgentId: connector.privateAgentId, endpointUrl: connectorEndpointUrl },
      params,
      agents: [agent],
    });

    if (!route.routed) {
      throw new Error(route.reason);
    }

    const policyDecisionHash = hashConnectorPayload({ connectorId: connector.id, policyDecision });
    const [insertedJob] = await db
      .insert(privateAgentJobs)
      .values({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        privateAgentId: route.privateAgentId,
        connectorId: connector.id,
        jobClass: route.jobClass,
        status: "queued",
        authorizedBy: "agent",
        authorizedByUserId: scope.userId ?? null,
        policyDecisionHash,
        jobSpecHash: route.jobSpecHash,
        jobSpec: route.jobSpec,
        idempotencyKey: route.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: privateAgentJobs.id });
    const existingJob = insertedJob
      ? null
      : await db.query.privateAgentJobs.findFirst({
          where: and(
            eq(privateAgentJobs.idempotencyKey, route.idempotencyKey),
            eq(privateAgentJobs.organizationId, scope.organizationId),
            eq(privateAgentJobs.projectId, scope.projectId)
          ),
          columns: { id: true },
        });
    const jobId = insertedJob?.id ?? existingJob?.id;

    if (!jobId) {
      throw new Error("Failed to queue Private Agent connector job");
    }

    await db.insert(sreInvestigationToolCalls).values({
      investigationRunId: scope.investigationRunId ?? null,
      connectorId: connector.id,
      connectorType: connector.type,
      toolName: "agent.connector.search.private_agent.queue",
      inputHash: hashConnectorPayload(route.jobSpec),
      inputSummary: redactConnectorText(JSON.stringify(route.jobSpec)),
      outputHash: route.jobSpecHash,
      outputSummary: `Queued Private Agent connector job ${jobId}`,
      status: "success",
      durationMs: Date.now() - startedAt,
      costEstimateCents: 0,
      executedAt: new Date(),
    });

    return {
      executionMode: "private_agent" as const,
      privateAgentJobId: jobId,
      queued: true,
      evidence: [],
      message: insertedJob ? "Queued Private Agent connector search" : "Private Agent connector search is already queued",
    };
  }

  const credentialRow = await db.query.externalConnectorCredentials.findFirst({
    where: eq(externalConnectorCredentials.connectorId, connector.id),
    orderBy: desc(externalConnectorCredentials.updatedAt),
  });
  const credential = credentialRow
    ? decryptConnectorCredential(credentialRow.encryptedCredential, {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        connectorId: connector.id,
      })
    : null;
  const directConnector = createDirectConnector({
    ...definition,
    endpointUrl: connectorEndpointUrl,
    credential: directConnectorCredential(credential),
  });
  const rawEvidence = await directConnector.search(params);
  const sanitized = sanitizeConnectorEvidence(rawEvidence, policyDecision.effectiveLimits);
  const insertedEvidence = sanitized.items.length
    ? await db.insert(sreEvidenceItems).values(sanitized.items.map((item) => evidenceInsertValue(scope, item))).returning()
    : [];

  await db.insert(sreInvestigationToolCalls).values({
    investigationRunId: scope.investigationRunId ?? null,
    connectorId: connector.id,
    connectorType: connector.type,
    toolName: "agent.connector.search",
    inputHash: hashConnectorPayload({ connectorId: connector.id, params }),
    inputSummary: redactConnectorText(JSON.stringify({ connectorId: connector.id, connectorType: connector.type, serviceId: primaryServiceId, query: input.query })),
    outputHash: sanitized.resultHash,
    outputSummary: `Returned ${insertedEvidence.length} evidence item(s)${sanitized.truncated ? " (truncated)" : ""}`,
    status: "success",
    durationMs: Date.now() - startedAt,
    costEstimateCents: 0,
    evidenceItemId: insertedEvidence[0]?.id ?? null,
    executedAt: new Date(),
  });

  return {
    executionMode: "direct" as const,
    queued: false,
    evidence: insertedEvidence.map(summarizeEvidenceItem),
    truncated: sanitized.truncated,
    message: `Persisted ${insertedEvidence.length} connector evidence item(s)`,
  };
}

export async function listIncidentDiagnosticQueries(scope: SreConnectorToolScope) {
  const { connectors } = await loadIncidentConnectors(scope);
  const connectorIds = connectors.map((entry) => entry.row.id);

  if (connectorIds.length === 0) {
    return { queries: [] };
  }

  const rows = await db
    .select({
      id: diagnosticQueries.id,
      connectorId: diagnosticQueries.connectorId,
      name: diagnosticQueries.name,
      queryType: diagnosticQueries.queryType,
      maxRows: diagnosticQueries.maxRows,
      maxBytes: diagnosticQueries.maxBytes,
      maxSeconds: diagnosticQueries.maxSeconds,
      connectorType: externalConnectors.type,
      connectorName: externalConnectors.name,
    })
    .from(diagnosticQueries)
    .innerJoin(externalConnectors, eq(diagnosticQueries.connectorId, externalConnectors.id))
    .where(
      and(
        eq(diagnosticQueries.organizationId, scope.organizationId),
        eq(diagnosticQueries.projectId, scope.projectId),
        eq(diagnosticQueries.status, "active"),
        inArray(diagnosticQueries.connectorId, connectorIds)
      )
    )
    .orderBy(desc(diagnosticQueries.createdAt))
    .limit(25);

  return {
    queries: rows.map((row) => ({
      id: row.id,
      name: row.name,
      queryType: row.queryType,
      connectorId: row.connectorId,
      connectorName: row.connectorName,
      connectorType: row.connectorType,
      limits: { maxRows: row.maxRows, maxBytes: row.maxBytes, maxSeconds: row.maxSeconds },
    })),
  };
}

export async function executeIncidentDiagnosticQuery(scope: SreConnectorToolScope, input: z.infer<typeof diagnosticQueryInputSchema>) {
  const startedAt = Date.now();
  const { connectors } = await loadIncidentConnectors(scope);
  const connectorIds = connectors.map((entry) => entry.row.id);

  const [definition] = await db
    .select({
      id: diagnosticQueries.id,
      connectorId: diagnosticQueries.connectorId,
      connectorType: externalConnectors.type,
      name: diagnosticQueries.name,
      queryType: diagnosticQueries.queryType,
      template: diagnosticQueries.template,
      parameterSchema: diagnosticQueries.parameterSchema,
      allowlist: diagnosticQueries.allowlist,
      maxRows: diagnosticQueries.maxRows,
      maxBytes: diagnosticQueries.maxBytes,
      maxSeconds: diagnosticQueries.maxSeconds,
    })
    .from(diagnosticQueries)
    .innerJoin(externalConnectors, eq(diagnosticQueries.connectorId, externalConnectors.id))
    .where(
      and(
        eq(diagnosticQueries.id, input.queryId),
        eq(diagnosticQueries.organizationId, scope.organizationId),
        eq(diagnosticQueries.projectId, scope.projectId),
        eq(diagnosticQueries.status, "active")
      )
    )
    .limit(1);

  if (!definition || !connectorIds.includes(definition.connectorId)) {
    throw new Error("Diagnostic query is not available for this incident service scope");
  }

  const rendered = renderDiagnosticQueryTemplate(definition, input.parameters);

  try {
    const result = await searchIncidentLiveConnectorEvidence(scope, {
      connectorId: definition.connectorId,
      query: rendered.query,
      timeWindowMinutes: input.timeWindowMinutes,
      maxRows: Math.min(rendered.effectiveLimits.maxRows, MAX_TOOL_ROWS),
      maxBytes: rendered.effectiveLimits.maxBytes,
      maxSeconds: rendered.effectiveLimits.maxSeconds,
    });

    await db.insert(sreInvestigationToolCalls).values({
      investigationRunId: scope.investigationRunId ?? null,
      connectorId: definition.connectorId,
      connectorType: definition.connectorType,
      toolName: "agent.connector.diagnostic_query",
      inputHash: rendered.inputHash,
      inputSummary: rendered.inputSummary,
      outputHash: hashConnectorPayload(result),
      outputSummary: `Executed diagnostic query "${definition.name}" with ${"evidence" in result ? result.evidence.length : 0} evidence item(s)`,
      status: "success",
      durationMs: Date.now() - startedAt,
      costEstimateCents: 0,
      executedAt: new Date(),
    });

    return {
      queryId: definition.id,
      name: definition.name,
      queryType: definition.queryType,
      renderedQuery: redactConnectorText(rendered.query),
      ...result,
    };
  } catch (error) {
    await db.insert(sreInvestigationToolCalls).values({
      investigationRunId: scope.investigationRunId ?? null,
      connectorId: definition.connectorId,
      connectorType: definition.connectorType,
      toolName: "agent.connector.diagnostic_query",
      inputHash: rendered.inputHash,
      inputSummary: rendered.inputSummary,
      status: "error",
      errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Diagnostic query failed",
      durationMs: Date.now() - startedAt,
      costEstimateCents: 0,
      executedAt: new Date(),
    });

    throw error;
  }
}

export function createSreConnectorTools(scope: SreConnectorToolScope) {
  return {
    listIncidentConnectors: tool({
      description: "List live read-only connectors available to the scoped incident's primary service.",
      inputSchema: z.object({}),
      execute: async () => listIncidentLiveConnectors(scope),
    }),
    searchLiveConnectorEvidence: tool({
      description: "Search one live read-only connector for the scoped incident's primary service. Direct connectors persist sanitized evidence immediately; Private Agent connectors queue a server-authorized job.",
      inputSchema: connectorSearchInputSchema,
      execute: async (input) => searchIncidentLiveConnectorEvidence(scope, input),
    }),
    listDiagnosticQueries: tool({
      description: "List admin-approved read-only diagnostic query templates available to the scoped incident service.",
      inputSchema: z.object({}),
      execute: async () => listIncidentDiagnosticQueries(scope),
    }),
    executeDiagnosticQuery: tool({
      description: "Execute one admin-approved read-only diagnostic query template with allowlisted parameters for the scoped incident service.",
      inputSchema: diagnosticQueryInputSchema,
      execute: async (input) => executeIncidentDiagnosticQuery(scope, input),
    }),
  };
}
