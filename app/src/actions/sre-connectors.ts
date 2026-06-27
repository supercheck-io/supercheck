"use server";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  externalConnectorCredentials,
  externalConnectors,
  externalConnectorServices,
  privateAgentJobs,
  privateAgents,
  sreInvestigationToolCalls,
  sreServices,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { normalizePrivateAgentEvidenceSummaries } from "@/lib/sre/connector-job-evidence";
import {
  DEFAULT_CONNECTOR_OUTPUT_LIMITS,
  decryptConnectorCredential,
  encryptConnectorCredential,
  assertEndpointAllowedForExecution,
  createDirectConnector,
  enforceConnectorPolicy,
  hashConnectorPayload,
  redactConnectorText,
  sanitizeConnectorEvidence,
  type ConnectorCredentialValue,
  type ConnectorDefinition,
} from "@/lib/sre/connectors";
import { getPrivateAgentHealth } from "@/lib/private-agents/agent-registry";
import { routeSreConnectorQuery } from "@/lib/private-agents/job-router";
import { checkSreConnectorSearchRateLimit, checkSreConnectorValidationRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const connectorTypes = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "datadog",
  "splunk",
  "appdynamics",
  "newrelic",
  "sentry",
  "loki",
  "elasticsearch",
  "tempo",
  "jaeger",
  "opentelemetry",
  "aws_cloudwatch",
  "gcp_monitoring",
  "azure_monitor",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "clickhouse",
  "kafka",
  "rabbitmq",
  "gitlab",
  "confluence",
  "notion",
  "slack",
  "teams",
  "pagerduty",
  "opsgenie",
  "jira",
  "mcp",
  "webhook",
  "supercheck_native",
] as const;

const credentialTypes = ["api_key", "oauth_token", "bearer_token", "basic_auth", "service_account"] as const;
const riskLevels = ["low", "medium", "high", "critical"] as const;

const flatCredentialValueSchema = z.record(z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]));

const createConnectorSchema = z.object({
  name: z.string().trim().min(1, "Connector name is required").max(100),
  type: z.enum(connectorTypes),
  riskLevel: z.enum(riskLevels).default("low"),
  endpointUrl: z.string().trim().url("Enter a valid endpoint URL").optional().or(z.literal("")),
  privateAgentId: z.string().uuid().optional().nullable(),
  serviceIds: z.array(z.string().uuid()).max(50).default([]),
  defaultTimeWindowMinutes: z.number().int().min(1).max(7 * 24 * 60).default(60),
  outputLimits: z
    .object({
      maxRows: z.number().int().min(1).max(1000).default(DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxRows),
      maxBytes: z.number().int().min(1024).max(5 * 1024 * 1024).default(DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxBytes),
      maxSeconds: z.number().int().min(1).max(30).default(DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxSeconds),
    })
    .default(DEFAULT_CONNECTOR_OUTPUT_LIMITS),
  credential: z
    .object({
      credentialType: z.enum(credentialTypes),
      value: flatCredentialValueSchema,
      expiresAt: z.coerce.date().optional().nullable(),
    })
    .optional(),
});

const disableConnectorSchema = z.object({
  id: z.string().uuid(),
});

const validateConnectorSchema = z.object({
  id: z.string().uuid(),
});

const rotateConnectorCredentialSchema = z.object({
  id: z.string().uuid(),
  credentialType: z.enum(credentialTypes),
  value: flatCredentialValueSchema,
  expiresAt: z.coerce.date().optional().nullable(),
});

const searchConnectorSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  query: z.string().trim().min(1).max(500),
  timeWindowMinutes: z.number().int().min(1).max(24 * 60).default(60),
});

const privateAgentJobResultSchema = z.object({
  jobId: z.string().uuid(),
});

const privateAgentSupportedConnectorTypes = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "sentry",
  "datadog",
  "loki",
  "elasticsearch",
  "tempo",
  "aws_cloudwatch",
] as const;

export type SreConnectorListItem = {
  id: string;
  name: string;
  type: (typeof connectorTypes)[number];
  status: "configured" | "valid" | "unreachable" | "missing_credentials" | "disabled";
  riskLevel: (typeof riskLevels)[number];
  executionMode: "direct" | "private_agent";
  privateAgent: { id: string; name: string; status: string; lastHeartbeatAt: Date | null } | null;
  scopedServiceIds: string[];
  hasCredentials: boolean;
  defaultTimeWindowMinutes: number;
  outputLimits: { maxRows: number; maxBytes: number; maxSeconds: number };
  endpointUrl: string | null;
  latestPrivateAgentJob: {
    id: string;
    status: "queued" | "leased" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
    createdAt: Date;
    completedAt: Date | null;
    errorCode: string | null;
    resultHash: string | null;
    evidenceCount: number;
    truncated: boolean;
  } | null;
  lastValidatedAt: Date | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SreConnectorActionResult =
  | { success: true; connector?: SreConnectorListItem; message: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreConnectorSearchResult =
  | {
      success: true;
      evidence: Array<{
        id: string;
        sourceUri: string;
        title: string;
        summary: string;
        evidenceType: string;
        observedAt: string;
        resultHash: string;
      }>;
      truncated: boolean;
      message: string;
      privateAgentJobId?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SrePrivateAgentJobResult =
  | {
      success: true;
      job: {
        id: string;
        status: "queued" | "leased" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
        connectorId: string | null;
        connectorName: string | null;
        createdAt: string;
        startedAt: string | null;
        completedAt: string | null;
        durationMs: number | null;
        errorCode: string | null;
        resultHash: string | null;
        truncated: boolean;
        evidence: Array<{
          id: string;
          sourceUri: string;
          title: string;
          summary: string;
          evidenceType: string;
          observedAt: string;
          resultHash: string;
        }>;
      };
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreConnectorSetupOptions = {
  services: Array<{ id: string; name: string; environment: string | null; ownerTeam: string | null }>;
  privateAgents: Array<{
    id: string;
    name: string;
    status: string;
    version: string | null;
    region: string | null;
    networkLabel: string | null;
    lastHeartbeatAt: Date | null;
  }>;
};

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).filter(([, errors]) => errors && errors.length > 0)
  ) as Record<string, string[]>;
}

function normalizeOutputLimits(value: Record<string, unknown> | null) {
  return {
    maxRows: typeof value?.maxRows === "number" ? value.maxRows : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxRows,
    maxBytes: typeof value?.maxBytes === "number" ? value.maxBytes : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxBytes,
    maxSeconds: typeof value?.maxSeconds === "number" ? value.maxSeconds : DEFAULT_CONNECTOR_OUTPUT_LIMITS.maxSeconds,
  };
}

function normalizeEndpointUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Connector endpoint must use http or https");
  }

  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function normalizePrivateAgentJobSummary(row: typeof privateAgentJobs.$inferSelect | null): SreConnectorListItem["latestPrivateAgentJob"] {
  if (!row) return null;

  const resultSummary = row.resultSummary;
  const evidence = Array.isArray(resultSummary?.evidence) ? resultSummary.evidence : [];

  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    errorCode: row.errorCode,
    resultHash: row.resultHash,
    evidenceCount: evidence.length,
    truncated: resultSummary?.truncated === true,
  };
}

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

function supportsDirectConnectorValidation(connectorType: (typeof connectorTypes)[number]) {
  return ["github", "kubernetes", "prometheus", "grafana", "sentry", "datadog", "loki", "elasticsearch", "tempo", "aws_cloudwatch"].includes(connectorType);
}

function supportsPrivateAgentConnector(connectorType: (typeof connectorTypes)[number]) {
  return privateAgentSupportedConnectorTypes.includes(connectorType as (typeof privateAgentSupportedConnectorTypes)[number]);
}

function validationUrl(connectorType: (typeof connectorTypes)[number], endpointUrl: string | null) {
  if (connectorType === "github") {
    return "https://api.github.com/rate_limit";
  }

  if (!endpointUrl) {
    return null;
  }

  switch (connectorType) {
    case "grafana":
      return `${endpointUrl}/api/health`;
    case "prometheus":
      return `${endpointUrl}/api/v1/status/runtimeinfo`;
    case "kubernetes":
      return `${endpointUrl}/version`;
    default:
      return endpointUrl;
  }
}

function buildConnectorDefinition(
  row: typeof externalConnectors.$inferSelect,
  scopedServiceIds: string[]
): ConnectorDefinition {
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

async function getScopedServiceIds(connectorId: string, organizationId: string, projectId: string) {
  const rows = await db
    .select({ serviceId: externalConnectorServices.serviceId })
    .from(externalConnectorServices)
    .where(
      and(
        eq(externalConnectorServices.organizationId, organizationId),
        eq(externalConnectorServices.projectId, projectId),
        eq(externalConnectorServices.connectorId, connectorId)
      )
    );

  return rows.map((row) => row.serviceId);
}

async function getConnectorListItem(
  connectorId: string,
  organizationId: string,
  projectId: string
): Promise<SreConnectorListItem | null> {
  const [row] = await db
    .select({
      connector: externalConnectors,
      privateAgentId: privateAgents.id,
      privateAgentName: privateAgents.name,
      privateAgentStatus: privateAgents.status,
      privateAgentLastHeartbeatAt: privateAgents.lastHeartbeatAt,
      credentialId: externalConnectorCredentials.id,
    })
    .from(externalConnectors)
    .leftJoin(privateAgents, eq(externalConnectors.privateAgentId, privateAgents.id))
    .leftJoin(externalConnectorCredentials, eq(externalConnectorCredentials.connectorId, externalConnectors.id))
    .where(
      and(
        eq(externalConnectors.id, connectorId),
        eq(externalConnectors.organizationId, organizationId),
        eq(externalConnectors.projectId, projectId)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const serviceRows = await db
    .select({ serviceId: externalConnectorServices.serviceId })
    .from(externalConnectorServices)
    .where(
      and(
        eq(externalConnectorServices.organizationId, organizationId),
        eq(externalConnectorServices.projectId, projectId),
        eq(externalConnectorServices.connectorId, connectorId)
      )
    );

  const latestJob = row.connector.privateAgentId
    ? await db.query.privateAgentJobs.findFirst({
        where: and(
          eq(privateAgentJobs.organizationId, organizationId),
          eq(privateAgentJobs.projectId, projectId),
          eq(privateAgentJobs.connectorId, connectorId),
          eq(privateAgentJobs.jobClass, "sre_connector_query")
        ),
        orderBy: desc(privateAgentJobs.createdAt),
      })
    : null;

  return {
    id: row.connector.id,
    name: row.connector.name,
    type: row.connector.type,
    status: row.connector.status,
    riskLevel: row.connector.riskLevel,
    executionMode: row.connector.privateAgentId ? "private_agent" : "direct",
    privateAgent: row.privateAgentId
      ? {
          id: row.privateAgentId,
          name: row.privateAgentName ?? "Private Agent",
          status: row.privateAgentStatus ?? "unknown",
          lastHeartbeatAt: row.privateAgentLastHeartbeatAt,
        }
      : null,
    scopedServiceIds: serviceRows.map((service) => service.serviceId),
    hasCredentials: Boolean(row.credentialId),
    defaultTimeWindowMinutes: row.connector.defaultTimeWindowMinutes,
    outputLimits: normalizeOutputLimits(row.connector.outputLimits),
    endpointUrl: typeof row.connector.config?.endpointUrl === "string" ? row.connector.config.endpointUrl : null,
    latestPrivateAgentJob: normalizePrivateAgentJobSummary(latestJob ?? null),
    lastValidatedAt: row.connector.lastValidatedAt,
    lastValidationStatus: row.connector.lastValidationStatus,
    lastValidationError: row.connector.lastValidationError,
    createdAt: row.connector.createdAt,
    updatedAt: row.connector.updatedAt,
  };
}

export async function getSreConnectors(): Promise<
  | { success: true; connectors: SreConnectorListItem[] }
  | { success: false; error: string; connectors: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_connector", "view", { userId, organizationId, project });

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view connectors", connectors: [] };
    }

    const rows = await db
      .select({ id: externalConnectors.id })
      .from(externalConnectors)
      .where(and(eq(externalConnectors.organizationId, organizationId), eq(externalConnectors.projectId, project.id)))
      .orderBy(desc(externalConnectors.updatedAt));

    const connectors = await Promise.all(
      rows.map((row) => getConnectorListItem(row.id, organizationId, project.id))
    );

    return { success: true, connectors: connectors.filter((connector): connector is SreConnectorListItem => Boolean(connector)) };
  } catch (error) {
    console.error("Error fetching SRE connectors:", error);
    return { success: false, error: "Failed to fetch connectors", connectors: [] };
  }
}

export async function getPrivateAgentConnectorJobResult(
  input: z.infer<typeof privateAgentJobResultSchema>
): Promise<SrePrivateAgentJobResult> {
  try {
    const parsed = privateAgentJobResultSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid Private Agent job", fieldErrors: formatValidationErrors(parsed.error) };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_connector", "view", { userId, organizationId, project });

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view Private Agent job results" };
    }

    const job = await db.query.privateAgentJobs.findFirst({
      where: and(
        eq(privateAgentJobs.id, parsed.data.jobId),
        eq(privateAgentJobs.organizationId, organizationId),
        eq(privateAgentJobs.projectId, project.id),
        eq(privateAgentJobs.jobClass, "sre_connector_query")
      ),
    });

    if (!job) {
      return { success: false, error: "Private Agent job not found or access denied" };
    }

    const connector = job.connectorId
      ? await db.query.externalConnectors.findFirst({
          where: and(
            eq(externalConnectors.id, job.connectorId),
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id)
          ),
          columns: { id: true, name: true },
        })
      : null;

    return {
      success: true,
      job: {
        id: job.id,
        status: job.status,
        connectorId: job.connectorId,
        connectorName: connector?.name ?? null,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        durationMs: job.durationMs,
        errorCode: job.errorCode,
        resultHash: job.resultHash,
        truncated: job.resultSummary?.truncated === true,
        evidence: normalizePrivateAgentEvidenceSummaries(job.resultSummary).map((item) => ({
          id: item.id,
          sourceUri: item.sourceUri,
          title: item.title,
          summary: item.summary,
          evidenceType: item.evidenceType,
          observedAt: item.observedAt,
          resultHash: item.resultHash,
        })),
      },
    };
  } catch (error) {
    console.error("Error fetching Private Agent connector job result:", error);
    return { success: false, error: "Failed to fetch Private Agent job result" };
  }
}

export async function getSreConnectorSetupOptions(): Promise<
  | { success: true; options: SreConnectorSetupOptions }
  | { success: false; error: string; options: SreConnectorSetupOptions }
> {
  const emptyOptions: SreConnectorSetupOptions = { services: [], privateAgents: [] };

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_connector", "view", { userId, organizationId, project });

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view connector setup options", options: emptyOptions };
    }

    const [services, agents] = await Promise.all([
      db
        .select({
          id: sreServices.id,
          name: sreServices.name,
          environment: sreServices.environment,
          ownerTeam: sreServices.ownerTeam,
        })
        .from(sreServices)
        .where(
          and(
            eq(sreServices.organizationId, organizationId),
            eq(sreServices.projectId, project.id),
            eq(sreServices.status, "active")
          )
        )
        .orderBy(sreServices.name),
      db
        .select({
          id: privateAgents.id,
          name: privateAgents.name,
          status: privateAgents.status,
          version: privateAgents.version,
          region: privateAgents.region,
          networkLabel: privateAgents.networkLabel,
          lastHeartbeatAt: privateAgents.lastHeartbeatAt,
        })
        .from(privateAgents)
        .where(
          and(
            eq(privateAgents.organizationId, organizationId),
            or(eq(privateAgents.projectId, project.id), isNull(privateAgents.projectId)),
            eq(privateAgents.supportsSreConnectors, true)
          )
        )
        .orderBy(desc(privateAgents.lastHeartbeatAt)),
    ]);

    return { success: true, options: { services, privateAgents: agents } };
  } catch (error) {
    console.error("Error fetching SRE connector setup options:", error);
    return { success: false, error: "Failed to fetch connector setup options", options: emptyOptions };
  }
}

export async function createSreConnector(input: z.infer<typeof createConnectorSchema>): Promise<SreConnectorActionResult> {
  try {
    const parsed = createConnectorSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid connector data", fieldErrors: formatValidationErrors(parsed.error) };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canConfigure = checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, project });

    if (!canConfigure) {
      return { success: false, error: "Insufficient permissions to configure connectors" };
    }

    const uniqueServiceIds = Array.from(new Set(parsed.data.serviceIds));
    if (uniqueServiceIds.length > 0) {
      const serviceRows = await db
        .select({ id: sreServices.id })
        .from(sreServices)
        .where(
          and(
            eq(sreServices.organizationId, organizationId),
            eq(sreServices.projectId, project.id),
            inArray(sreServices.id, uniqueServiceIds)
          )
        );

      if (serviceRows.length !== uniqueServiceIds.length) {
        return { success: false, error: "One or more selected services were not found" };
      }
    }

    if (parsed.data.privateAgentId && !supportsPrivateAgentConnector(parsed.data.type)) {
      return { success: false, error: `${parsed.data.type.replace(/_/g, " ")} currently supports direct execution only. Private Agent support is a follow-up task.` };
    }

    const endpointUrl = normalizeEndpointUrl(parsed.data.endpointUrl);
    await assertEndpointAllowedForExecution(endpointUrl, Boolean(parsed.data.privateAgentId));

    if (parsed.data.privateAgentId) {
      const agent = await db.query.privateAgents.findFirst({
        where: and(
          eq(privateAgents.id, parsed.data.privateAgentId),
          eq(privateAgents.organizationId, organizationId),
          or(eq(privateAgents.projectId, project.id), isNull(privateAgents.projectId))
        ),
        columns: { id: true, status: true, supportsSreConnectors: true },
      });

      if (!agent || agent.status === "disabled" || !agent.supportsSreConnectors) {
        return { success: false, error: "Selected Private Agent is unavailable for SRE connectors" };
      }
    }

    const connector = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(externalConnectors)
        .values({
          organizationId,
          projectId: project.id,
          privateAgentId: parsed.data.privateAgentId ?? null,
          name: parsed.data.name,
          type: parsed.data.type,
          config: endpointUrl ? { endpointUrl } : {},
          riskLevel: parsed.data.riskLevel,
          permissionLevel: "read",
          sideEffectLevel: "none",
          status: parsed.data.credential ? "configured" : "missing_credentials",
          defaultTimeWindowMinutes: parsed.data.defaultTimeWindowMinutes,
          outputLimits: parsed.data.outputLimits,
          createdByUserId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (parsed.data.credential) {
        const encrypted = encryptConnectorCredential(parsed.data.credential.value as ConnectorCredentialValue, {
          organizationId,
          projectId: project.id,
          connectorId: created.id,
        });

        await tx.insert(externalConnectorCredentials).values({
          connectorId: created.id,
          credentialType: parsed.data.credential.credentialType,
          encryptedCredential: encrypted.encryptedCredential,
          encryptionVersion: encrypted.encryptionVersion,
          encryptionKeyContext: encrypted.encryptionKeyContext,
          expiresAt: parsed.data.credential.expiresAt ?? null,
          lastRotatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      if (uniqueServiceIds.length > 0) {
        await tx.insert(externalConnectorServices).values(
          uniqueServiceIds.map((serviceId) => ({
            organizationId,
            projectId: project.id,
            connectorId: created.id,
            serviceId,
            createdAt: new Date(),
          }))
        );
      }

      return created;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_connector_created",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: {
        projectId: project.id,
        connectorType: connector.type,
        executionMode: connector.privateAgentId ? "private_agent" : "direct",
        scopedServiceCount: uniqueServiceIds.length,
        hasCredentials: Boolean(parsed.data.credential),
      },
      success: true,
    });

    revalidatePath("/org-admin/connectors");
    return {
      success: true,
      connector: (await getConnectorListItem(connector.id, organizationId, project.id)) ?? undefined,
      message: "Connector configured",
    };
  } catch (error) {
    console.error("Error creating SRE connector:", error);
    return { success: false, error: "Failed to configure connector" };
  }
}

export async function validateSreConnector(input: z.infer<typeof validateConnectorSchema>): Promise<SreConnectorActionResult> {
  const startedAt = Date.now();

  try {
    const parsed = validateConnectorSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid connector ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canConfigure = checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, project });

    if (!canConfigure) {
      return { success: false, error: "Insufficient permissions to validate connectors" };
    }

    const row = await db.query.externalConnectors.findFirst({
      where: and(
        eq(externalConnectors.id, parsed.data.id),
        eq(externalConnectors.organizationId, organizationId),
        eq(externalConnectors.projectId, project.id)
      ),
    });

    if (!row) {
      return { success: false, error: "Connector not found or access denied" };
    }

    if (row.status === "disabled") {
      return { success: false, error: "Disabled connectors cannot be validated" };
    }

    const rateLimit = await checkSreConnectorValidationRateLimit(userId, row.id);
    if (!rateLimit.allowed) {
      return { success: false, error: "Connector validation rate limit reached. Wait a moment and try again." };
    }

    const credentialRow = await db.query.externalConnectorCredentials.findFirst({
      where: eq(externalConnectorCredentials.connectorId, row.id),
      orderBy: desc(externalConnectorCredentials.updatedAt),
    });

    const endpointUrl = typeof row.config?.endpointUrl === "string" ? row.config.endpointUrl : null;
    const inputSummary = JSON.stringify({
      connectorId: row.id,
      connectorType: row.type,
      executionMode: row.privateAgentId ? "private_agent" : "direct",
      endpointHost: endpointUrl ? new URL(endpointUrl).host : null,
    });

    let status: "valid" | "unreachable" | "invalid_credentials" | "policy_blocked" = "valid";
    let outputSummary = "Connector validation passed";

    if (!credentialRow && row.type !== "webhook") {
      status = "invalid_credentials";
      outputSummary = "Connector is missing credentials";
    } else if (row.privateAgentId) {
      const agent = await db.query.privateAgents.findFirst({
        where: and(
          eq(privateAgents.id, row.privateAgentId),
          eq(privateAgents.organizationId, organizationId),
          or(eq(privateAgents.projectId, project.id), isNull(privateAgents.projectId))
        ),
      });

      if (!agent || !getPrivateAgentHealth(agent).healthy || !agent.supportsSreConnectors) {
        status = "unreachable";
        outputSummary = "Configured Private Agent is not healthy or does not support SRE connectors";
      }
    } else {
      await assertEndpointAllowedForExecution(endpointUrl, false);
      const url = validationUrl(row.type, endpointUrl);

      if (supportsDirectConnectorValidation(row.type)) {
        const credential = credentialRow
          ? decryptConnectorCredential(credentialRow.encryptedCredential, {
              organizationId,
              projectId: project.id,
              connectorId: row.id,
            })
          : null;
        const directConnector = createDirectConnector({
          ...buildConnectorDefinition(row, []),
          endpointUrl,
          credential: directConnectorCredential(credential),
        });
        const validation = await directConnector.validate();
        status = validation.status;
        outputSummary = validation.message ?? (validation.status === "valid" ? "Connector validation passed" : "Connector validation failed");
      } else if (!url && row.type !== "github" && row.type !== "webhook") {
        status = "policy_blocked";
        outputSummary = "Connector endpoint URL is required for direct validation";
      } else if (url) {
        const credential = credentialRow
          ? decryptConnectorCredential(credentialRow.encryptedCredential, {
              organizationId,
              projectId: project.id,
              connectorId: row.id,
            })
          : null;

        const secret = credentialSecret(credential);
        const response = await fetch(url, {
          method: "GET",
          headers: secret
            ? {
                Authorization: `Bearer ${secret}`,
                Accept: "application/json",
              }
            : { Accept: "application/json" },
          signal: AbortSignal.timeout(Math.min((normalizeOutputLimits(row.outputLimits).maxSeconds || 10) * 1000, 30_000)),
          cache: "no-store",
        });

        if (response.status === 401 || response.status === 403) {
          status = "invalid_credentials";
          outputSummary = `Connector credential rejected with HTTP ${response.status}`;
        } else if (!response.ok) {
          status = "unreachable";
          outputSummary = `Connector validation failed with HTTP ${response.status}`;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const connectorStatus =
      status === "valid"
        ? "valid"
        : status === "invalid_credentials"
          ? "missing_credentials"
          : status === "policy_blocked"
            ? "configured"
            : "unreachable";

    await db.transaction(async (tx) => {
      await tx.update(externalConnectors).set({
        status: connectorStatus,
        lastValidatedAt: new Date(),
        lastValidationStatus: status,
        lastValidationError: status === "valid" ? null : outputSummary,
        lastValidationLatencyMs: durationMs,
        updatedAt: new Date(),
      }).where(eq(externalConnectors.id, row.id));

      await tx.insert(sreInvestigationToolCalls).values({
        connectorId: row.id,
        connectorType: row.type,
        toolName: "connector.validate",
        inputHash: hashConnectorPayload({ connectorId: row.id, inputSummary }),
        inputSummary,
        outputHash: hashConnectorPayload({ status, outputSummary: redactConnectorText(outputSummary) }),
        outputSummary: redactConnectorText(outputSummary),
        status: status === "valid" ? "success" : "error",
        errorMessage: status === "valid" ? null : redactConnectorText(outputSummary),
        durationMs,
        costEstimateCents: 0,
        executedAt: new Date(),
      });
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_connector_validated",
      resource: "sre_connector",
      resourceId: row.id,
      metadata: {
        projectId: project.id,
        connectorType: row.type,
        validationStatus: status,
        durationMs,
      },
      success: status === "valid",
    });

    revalidatePath("/org-admin/connectors");
    return {
      success: true,
      connector: (await getConnectorListItem(row.id, organizationId, project.id)) ?? undefined,
      message: status === "valid" ? "Connector validation passed" : outputSummary,
    };
  } catch (error) {
    console.error("Error validating SRE connector:", error);
    return { success: false, error: "Failed to validate connector" };
  }
}

export async function rotateSreConnectorCredential(
  input: z.infer<typeof rotateConnectorCredentialSchema>
): Promise<SreConnectorActionResult> {
  try {
    const parsed = rotateConnectorCredentialSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid connector credential", fieldErrors: formatValidationErrors(parsed.error) };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canConfigure = checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, project });

    if (!canConfigure) {
      return { success: false, error: "Insufficient permissions to rotate connector credentials" };
    }

    const connector = await db.query.externalConnectors.findFirst({
      where: and(
        eq(externalConnectors.id, parsed.data.id),
        eq(externalConnectors.organizationId, organizationId),
        eq(externalConnectors.projectId, project.id)
      ),
    });

    if (!connector || connector.status === "disabled") {
      return { success: false, error: "Connector not found or disabled" };
    }

    const encrypted = encryptConnectorCredential(parsed.data.value as ConnectorCredentialValue, {
      organizationId,
      projectId: project.id,
      connectorId: connector.id,
    });

    await db.transaction(async (tx) => {
      await tx.delete(externalConnectorCredentials).where(eq(externalConnectorCredentials.connectorId, connector.id));

      await tx.insert(externalConnectorCredentials).values({
        connectorId: connector.id,
        credentialType: parsed.data.credentialType,
        encryptedCredential: encrypted.encryptedCredential,
        encryptionVersion: encrypted.encryptionVersion,
        encryptionKeyContext: encrypted.encryptionKeyContext,
        expiresAt: parsed.data.expiresAt ?? null,
        lastRotatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx
        .update(externalConnectors)
        .set({
          status: "configured",
          lastValidatedAt: null,
          lastValidationStatus: null,
          lastValidationError: null,
          lastValidationLatencyMs: null,
          updatedAt: new Date(),
        })
        .where(eq(externalConnectors.id, connector.id));
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_connector_credential_rotated",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: {
        projectId: project.id,
        connectorType: connector.type,
        credentialType: parsed.data.credentialType,
      },
      success: true,
    });

    revalidatePath("/org-admin/connectors");
    return {
      success: true,
      connector: (await getConnectorListItem(connector.id, organizationId, project.id)) ?? undefined,
      message: "Connector credential rotated",
    };
  } catch (error) {
    console.error("Error rotating SRE connector credential:", error);
    return { success: false, error: "Failed to rotate connector credential" };
  }
}

export async function searchSreConnectorEvidence(input: z.infer<typeof searchConnectorSchema>): Promise<SreConnectorSearchResult> {
  const startedAt = Date.now();

  try {
    const parsed = searchConnectorSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid connector search", fieldErrors: formatValidationErrors(parsed.error) };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_connector", "investigate", { userId, organizationId, project });

    if (!canInvestigate) {
      return { success: false, error: "Insufficient permissions to search connector evidence" };
    }

    const connector = await db.query.externalConnectors.findFirst({
      where: and(
        eq(externalConnectors.id, parsed.data.id),
        eq(externalConnectors.organizationId, organizationId),
        eq(externalConnectors.projectId, project.id)
      ),
    });

    if (!connector || connector.status === "disabled") {
      return { success: false, error: "Connector not found or disabled" };
    }

    const scopedServiceIds = await getScopedServiceIds(connector.id, organizationId, project.id);
    const serviceAllowed =
      scopedServiceIds.length === 0 || scopedServiceIds.includes(parsed.data.serviceId);

    if (!serviceAllowed) {
      return { success: false, error: "Connector is not scoped to the requested service" };
    }

    const searchRateLimit = await checkSreConnectorSearchRateLimit(userId, connector.id);
    if (!searchRateLimit.allowed) {
      return { success: false, error: "Connector search rate limit reached. Wait a moment and try again." };
    }

    const service = await db.query.sreServices.findFirst({
      where: and(
        eq(sreServices.id, parsed.data.serviceId),
        eq(sreServices.organizationId, organizationId),
        eq(sreServices.projectId, project.id)
      ),
      columns: { id: true },
    });

    if (!service) {
      return { success: false, error: "Service not found or access denied" };
    }

    const endpointUrl = typeof connector.config?.endpointUrl === "string" ? connector.config.endpointUrl : null;
    await assertEndpointAllowedForExecution(endpointUrl, Boolean(connector.privateAgentId));

    const now = new Date();
    const timeWindow = {
      start: new Date(now.getTime() - parsed.data.timeWindowMinutes * 60_000),
      end: now,
    };
    const definition = buildConnectorDefinition(connector, scopedServiceIds);
    const params = {
      query: parsed.data.query,
      serviceId: parsed.data.serviceId,
      timeWindow,
      budget: {
        maxRows: Math.min(definition.outputLimits.maxRows, 25),
        maxBytes: Math.min(definition.outputLimits.maxBytes, 512_000),
        maxSeconds: Math.min(definition.outputLimits.maxSeconds, 15),
        maxCost: 0,
      },
    };
    const decision = enforceConnectorPolicy({
      organizationId,
      projectId: project.id,
      connector: definition,
      params,
      actor: { actorType: "user", userId },
    });

    if (connector.privateAgentId) {
      const agent = await db.query.privateAgents.findFirst({
        where: and(
          eq(privateAgents.id, connector.privateAgentId),
          eq(privateAgents.organizationId, organizationId),
          or(eq(privateAgents.projectId, project.id), isNull(privateAgents.projectId))
        ),
      });

      if (!agent) {
        return { success: false, error: "Configured Private Agent was not found" };
      }

      const route = routeSreConnectorQuery({
        organizationId,
        projectId: project.id,
        connector: { ...definition, privateAgentId: connector.privateAgentId, endpointUrl },
        params,
        agents: [agent],
      });

      if (!route.routed) {
        return { success: false, error: route.reason };
      }

      const policyDecisionHash = hashConnectorPayload({ connectorId: connector.id, decision });
      const [insertedJob] = await db
        .insert(privateAgentJobs)
        .values({
          organizationId,
          projectId: project.id,
          privateAgentId: route.privateAgentId,
          connectorId: connector.id,
          jobClass: route.jobClass,
          status: "queued",
          authorizedBy: "user",
          authorizedByUserId: userId,
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
              eq(privateAgentJobs.organizationId, organizationId),
              eq(privateAgentJobs.projectId, project.id)
            ),
            columns: { id: true },
          });
      const jobId = insertedJob?.id ?? existingJob?.id;

      if (!jobId) {
        return { success: false, error: "Failed to queue Private Agent connector job" };
      }

      const durationMs = Date.now() - startedAt;
      await db.insert(sreInvestigationToolCalls).values({
        connectorId: connector.id,
        connectorType: connector.type,
        toolName: "connector.search.private_agent.queue",
        inputHash: hashConnectorPayload(route.jobSpec),
        inputSummary: redactConnectorText(JSON.stringify(route.jobSpec)),
        outputHash: route.jobSpecHash,
        outputSummary: `Queued Private Agent connector job ${jobId}`,
        status: "success",
        durationMs,
        costEstimateCents: 0,
        executedAt: new Date(),
      });

      await logAuditEvent({
        userId,
        organizationId,
        action: "sre_connector_search_queued",
        resource: "sre_connector",
        resourceId: connector.id,
        metadata: {
          projectId: project.id,
          connectorType: connector.type,
          serviceId: parsed.data.serviceId,
          privateAgentId: route.privateAgentId,
          privateAgentJobId: jobId,
          durationMs,
        },
        success: true,
      });

      return {
        success: true,
        evidence: [],
        truncated: false,
        privateAgentJobId: jobId,
        message: insertedJob ? "Queued Private Agent connector search" : "Private Agent connector search is already queued",
      };
    }

    const credentialRow = await db.query.externalConnectorCredentials.findFirst({
      where: eq(externalConnectorCredentials.connectorId, connector.id),
      orderBy: desc(externalConnectorCredentials.updatedAt),
    });
    const credential = credentialRow
      ? decryptConnectorCredential(credentialRow.encryptedCredential, {
          organizationId,
          projectId: project.id,
          connectorId: connector.id,
        })
      : null;

    const directConnector = createDirectConnector({
      ...definition,
      endpointUrl,
      credential: directConnectorCredential(credential),
    });
    const rawEvidence = await directConnector.search(params);
    const sanitized = sanitizeConnectorEvidence(rawEvidence, decision.effectiveLimits);
    const durationMs = Date.now() - startedAt;
    const inputSummary = JSON.stringify({
      connectorId: connector.id,
      connectorType: connector.type,
      serviceId: parsed.data.serviceId,
      query: parsed.data.query,
      timeWindowMinutes: parsed.data.timeWindowMinutes,
    });

    await db.insert(sreInvestigationToolCalls).values({
      connectorId: connector.id,
      connectorType: connector.type,
      toolName: "connector.search",
      inputHash: hashConnectorPayload({ connectorId: connector.id, inputSummary }),
      inputSummary: redactConnectorText(inputSummary),
      outputHash: sanitized.resultHash,
      outputSummary: `Returned ${sanitized.items.length} evidence item(s)${sanitized.truncated ? " (truncated)" : ""}`,
      status: "success",
      durationMs,
      costEstimateCents: 0,
      executedAt: new Date(),
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_connector_searched",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: {
        projectId: project.id,
        connectorType: connector.type,
        serviceId: parsed.data.serviceId,
        evidenceCount: sanitized.items.length,
        truncated: sanitized.truncated,
        durationMs,
      },
      success: true,
    });

    return {
      success: true,
      evidence: sanitized.items.map((item) => ({
        id: item.id,
        sourceUri: item.sourceUri,
        title: item.title,
        summary: item.summary,
        evidenceType: item.evidenceType,
        observedAt: item.metadata.timestamp.toISOString(),
        resultHash: item.citation.resultHash,
      })),
      truncated: sanitized.truncated,
      message: `Returned ${sanitized.items.length} evidence item(s)`,
    };
  } catch (error) {
    console.error("Error searching SRE connector evidence:", error);
    return { success: false, error: "Failed to search connector evidence" };
  }
}

export async function disableSreConnector(input: z.infer<typeof disableConnectorSchema>): Promise<SreConnectorActionResult> {
  try {
    const parsed = disableConnectorSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid connector ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canConfigure = checkPermissionWithContext("sre_connector", "configure", { userId, organizationId, project });

    if (!canConfigure) {
      return { success: false, error: "Insufficient permissions to disable connectors" };
    }

    const [connector] = await db
      .update(externalConnectors)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(
        and(
          eq(externalConnectors.id, parsed.data.id),
          eq(externalConnectors.organizationId, organizationId),
          eq(externalConnectors.projectId, project.id)
        )
      )
      .returning();

    if (!connector) {
      return { success: false, error: "Connector not found or access denied" };
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_connector_disabled",
      resource: "sre_connector",
      resourceId: connector.id,
      metadata: { projectId: project.id, connectorType: connector.type },
      success: true,
    });

    revalidatePath("/org-admin/connectors");
    return {
      success: true,
      connector: (await getConnectorListItem(connector.id, organizationId, project.id)) ?? undefined,
      message: "Connector disabled",
    };
  } catch (error) {
    console.error("Error disabling SRE connector:", error);
    return { success: false, error: "Failed to disable connector" };
  }
}
