"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  alertHistory,
  jobs,
  monitors,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
  sreIncidentTimelineEvents,
  sreEvidenceItems,
  sreInvestigationRuns,
  sreInvestigationReportFeedback,
  sreInvestigationReports,
  sreInvestigationToolCalls,
  sreServiceDependencies,
  sreServiceResources,
  sreServices,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/index";
import {
  ALERT_CORRELATION_LIMITS,
  selectAlertCorrelationMatch,
} from "@/lib/sre/alert-correlation";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  archiveSreConversation,
  getSreConversation,
  listSreConversations,
  listSreMessages,
} from "@/sre/lib/session-store";
import {
  maybeRunAutomaticSreTriage,
  type AutomaticSreTriageResult,
} from "@/sre/lib/triage-automation";
import {
  isSreAlertCorrelationEnabled,
  isSreInvestigationAgentEnabled,
} from "@/sre/lib/feature-gates";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-incidents" }) as {
  error: (data: unknown, message?: string) => void;
  warn: (data: unknown, message?: string) => void;
};

const createIncidentFromAlertSchema = z.object({
  alertHistoryId: z.string().uuid(),
});

const createManualIncidentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Incident title is required")
    .max(500, "Incident title is too long"),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]).default("sev3"),
  summary: z
    .string()
    .trim()
    .max(2000, "Summary is too long")
    .optional()
    .nullable(),
});

const updateIncidentSchema = z.object({
  id: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, "Incident title is required")
    .max(500, "Incident title is too long"),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  status: z.enum([
    "triggered",
    "investigating",
    "identified",
    "recommendations_ready",
    "user_applying_fix",
    "verifying",
    "resolved",
  ]),
  primaryServiceId: z.string().uuid().nullable(),
});

const archiveIncidentChatSchema = z.object({
  incidentId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

type SreSeverity = "sev1" | "sev2" | "sev3" | "sev4";
type SreAlertStatus = "firing" | "resolved";
type SreAlertSourceType = "monitor" | "job";
type SreInvestigationStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "timed_out";

export type CreateSreIncidentFromAlertResult =
  | {
      success: true;
      incident: {
        id: string;
        incidentNumber: number;
        title: string;
      };
      triage?: AutomaticSreTriageResult;
      existing: boolean;
      message: string;
    }
  | { success: false; error: string };

export type CreateManualSreIncidentResult =
  | {
      success: true;
      incident: {
        id: string;
        incidentNumber: number;
        title: string;
      };
      message: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type UpdateSreIncidentResult =
  | {
      success: true;
      incident: {
        id: string;
        incidentNumber: number;
        title: string;
      };
      message: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreIncidentListItem = {
  id: string;
  incidentNumber: number;
  title: string;
  severity: SreSeverity;
  status:
    | "triggered"
    | "investigating"
    | "identified"
    | "recommendations_ready"
    | "user_applying_fix"
    | "verifying"
    | "resolved";
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  alertCount: number;
  evidenceCount: number;
  investigationCount: number;
  latestInvestigationStatus: SreInvestigationStatus | null;
  latestInvestigationCompletedAt: Date | null;
  latestInvestigationCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type SreIncidentChatHistory = {
  conversationId: string;
  title: string | null;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    modelId: string | null;
  }>;
};

export type SreIncidentDetail = {
  incident: SreIncidentListItem & {
    rootCauseSummary: string | null;
    confidenceScore: string | null;
  };
  latestBrief: {
    id: string;
    modelId: string;
    status: "running" | "completed" | "failed" | "aborted" | "timed_out";
    rootCauseHypothesis: string | null;
    confidenceScore: string | null;
    agentStateSnapshot: Record<string, unknown> | null;
    completedAt: Date | null;
    createdAt: Date;
  } | null;
  latestInvestigation: {
    id: string;
    modelId: string;
    status: "running" | "completed" | "failed" | "aborted" | "timed_out";
    summary: string | null;
    completedAt: Date | null;
    createdAt: Date;
  } | null;
  latestReportSnapshot: {
    id: string;
    title: string | null;
    createdAt: Date;
    reportHash: string;
    investigationRunId: string;
  } | null;
  myReportFeedback: {
    accuracy: "accurate" | "partially_accurate" | "incorrect" | "needs_more_evidence";
    notes: string | null;
    rejectedHypotheses: string[];
    updatedAt: Date;
  } | null;
  evidence: Array<{
    id: string;
    title: string;
    summary: string | null;
    sourceUri: string;
    evidenceType: string;
    severity: string | null;
    confidence: string | null;
    rawContentExcerpt: string | null;
    citationQuery: string | null;
    observedAt: Date | null;
    createdAt: Date;
  }>;
  chatHistory: SreIncidentChatHistory | null;
  chatHistories: SreIncidentChatHistory[];
  toolMetrics: {
    total: number;
    errors: number;
    averageDurationMs: number;
  };
  permissions: {
    canUpdate: boolean;
    canInvestigate: boolean;
    canUseLiveConnectors: boolean;
  };
  capabilities: {
    investigationEnabled: boolean;
  };
};

export type SreIncidentAnalytics = {
  windowDays: number;
  summary: {
    created: number;
    resolved: number;
    resolutionRate: number;
    averageResolutionMinutes: number | null;
  };
  daily: Array<{
    date: string;
    created: number;
    resolved: number;
  }>;
  severities: Array<{ severity: SreSeverity; count: number }>;
  topServices: Array<{
    serviceId: string | null;
    serviceName: string;
    count: number;
  }>;
};

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function getSreIncidentAnalytics(): Promise<
  | { success: true; analytics: SreIncidentAnalytics }
  | { success: false; error: string; analytics: null }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_incident", "view", {
      userId,
      organizationId,
      project,
    });
    if (!canView) {
      return {
        success: false,
        error: "Insufficient permissions to view incident analytics",
        analytics: null,
      };
    }

    const windowDays = 30;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCHours(0, 0, 0, 0);
    windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));
    const scope = and(
      eq(sreIncidents.organizationId, organizationId),
      eq(sreIncidents.projectId, project.id),
    );

    const [summaryRows, createdRows, resolvedRows, severityRows, serviceRows] =
      await Promise.all([
        db
          .select({
            created: sql<number>`count(${sreIncidents.id})::int`,
            resolved: sql<number>`count(${sreIncidents.id}) filter (where ${sreIncidents.resolvedAt} is not null)::int`,
            averageResolutionMinutes: sql<
              number | null
            >`avg(extract(epoch from (${sreIncidents.resolvedAt} - ${sreIncidents.createdAt})) / 60) filter (where ${sreIncidents.resolvedAt} is not null)`,
          })
          .from(sreIncidents)
          .where(and(scope, gte(sreIncidents.createdAt, windowStart))),
        db
          .select({
            date: sql<string>`to_char(date_trunc('day', ${sreIncidents.createdAt}), 'YYYY-MM-DD')`,
            count: sql<number>`count(${sreIncidents.id})::int`,
          })
          .from(sreIncidents)
          .where(and(scope, gte(sreIncidents.createdAt, windowStart)))
          .groupBy(sql`date_trunc('day', ${sreIncidents.createdAt})`),
        db
          .select({
            date: sql<string>`to_char(date_trunc('day', ${sreIncidents.resolvedAt}), 'YYYY-MM-DD')`,
            count: sql<number>`count(${sreIncidents.id})::int`,
          })
          .from(sreIncidents)
          .where(
            and(
              scope,
              isNotNull(sreIncidents.resolvedAt),
              gte(sreIncidents.resolvedAt, windowStart),
            ),
          )
          .groupBy(sql`date_trunc('day', ${sreIncidents.resolvedAt})`),
        db
          .select({
            severity: sreIncidents.severity,
            count: sql<number>`count(${sreIncidents.id})::int`,
          })
          .from(sreIncidents)
          .where(and(scope, gte(sreIncidents.createdAt, windowStart)))
          .groupBy(sreIncidents.severity),
        db
          .select({
            serviceId: sreIncidents.primaryServiceId,
            serviceName: sql<string>`coalesce(${sreServices.name}, 'Unmapped')`,
            count: sql<number>`count(${sreIncidents.id})::int`,
          })
          .from(sreIncidents)
          .leftJoin(
            sreServices,
            eq(sreIncidents.primaryServiceId, sreServices.id),
          )
          .where(and(scope, gte(sreIncidents.createdAt, windowStart)))
          .groupBy(sreIncidents.primaryServiceId, sreServices.name)
          .orderBy(desc(sql`count(${sreIncidents.id})`))
          .limit(5),
      ]);

    const createdByDate = new Map(
      createdRows.map((row) => [row.date, row.count]),
    );
    const resolvedByDate = new Map(
      resolvedRows.map((row) => [row.date, row.count]),
    );
    const daily = Array.from({ length: windowDays }, (_, index) => {
      const date = new Date(windowStart);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        created: createdByDate.get(key) ?? 0,
        resolved: resolvedByDate.get(key) ?? 0,
      };
    });
    const summary = summaryRows[0] ?? {
      created: 0,
      resolved: 0,
      averageResolutionMinutes: null,
    };

    return {
      success: true,
      analytics: {
        windowDays,
        summary: {
          created: summary.created,
          resolved: summary.resolved,
          resolutionRate:
            summary.created > 0
              ? Math.round((summary.resolved / summary.created) * 100)
              : 0,
          averageResolutionMinutes:
            summary.averageResolutionMinutes === null
              ? null
              : Math.round(Number(summary.averageResolutionMinutes)),
        },
        daily,
        severities: severityRows,
        topServices: serviceRows,
      },
    };
  } catch (error) {
    logger.error({ error }, "Error fetching SRE incident analytics");
    return {
      success: false,
      error: "Failed to fetch incident analytics",
      analytics: null,
    };
  }
}

function deriveSeverity(type: string, message: string): SreSeverity {
  const normalizedType = type.toLowerCase();
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("sev1") ||
    normalizedMessage.includes("critical") ||
    normalizedType.includes("timeout")
  ) {
    return "sev1";
  }

  if (normalizedType.includes("failure") || normalizedType.includes("failed")) {
    return "sev2";
  }

  if (normalizedType.includes("ssl") || normalizedMessage.includes("expir")) {
    return "sev3";
  }

  return "sev4";
}

function deriveAlertStatus(type: string): SreAlertStatus {
  const normalizedType = type.toLowerCase();
  return normalizedType.includes("recovery") ||
    normalizedType.includes("success")
    ? "resolved"
    : "firing";
}

function isActionableAlertForIncident(
  status: "sent" | "failed" | "pending",
  type: string,
  message: string,
) {
  if (status !== "sent") {
    return false;
  }

  const normalizedType = type.toLowerCase();
  const normalizedMessage = message.toLowerCase();
  return !(
    normalizedType.includes("recovery") ||
    normalizedType.includes("success") ||
    normalizedType.includes("resolved") ||
    normalizedMessage.includes("completed successfully")
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).filter(
      ([, errors]) => errors && errors.length > 0,
    ),
  ) as Record<string, string[]>;
}

async function getConversationHistory(input: {
  organizationId: string;
  projectId: string;
  userId: string;
  conversationId: string;
  title: string | null;
  updatedAt: Date;
}): Promise<SreIncidentChatHistory> {
  const messages = await listSreMessages({
    organizationId: input.organizationId,
    projectId: input.projectId,
    userId: input.userId,
    conversationId: input.conversationId,
  });

  return {
    conversationId: input.conversationId,
    title: input.title,
    updatedAt: input.updatedAt,
    messages: messages.flatMap((message) => {
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        !message.content
      ) {
        return [];
      }

      return [
        {
          id: message.id,
          role: message.role,
          content: message.content,
          modelId: message.modelId,
        },
      ];
    }),
  };
}

export async function getSreIncidents(): Promise<
  | { success: true; incidents: SreIncidentListItem[] }
  | { success: false; error: string; incidents: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_incident", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return {
        success: false,
        error: "Insufficient permissions to view SRE incidents",
        incidents: [],
      };
    }

    const rows = await db
      .select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        primaryServiceId: sreIncidents.primaryServiceId,
        primaryServiceName: sreServices.name,
        createdAt: sreIncidents.createdAt,
        updatedAt: sreIncidents.updatedAt,
        resolvedAt: sreIncidents.resolvedAt,
        alertCount: sql<number>`count(${sreIncidentAlerts.alertEventId})::int`,
      })
      .from(sreIncidents)
      .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
      .leftJoin(
        sreIncidentAlerts,
        eq(sreIncidentAlerts.incidentId, sreIncidents.id),
      )
      .where(
        and(
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id),
        ),
      )
      .groupBy(
        sreIncidents.id,
        sreIncidents.incidentNumber,
        sreIncidents.title,
        sreIncidents.severity,
        sreIncidents.status,
        sreIncidents.primaryServiceId,
        sreServices.name,
        sreIncidents.createdAt,
        sreIncidents.updatedAt,
        sreIncidents.resolvedAt,
      )
      .orderBy(desc(sreIncidents.updatedAt));

    const incidentIds = rows.map((row) => row.id);

    if (incidentIds.length === 0) {
      return { success: true, incidents: [] };
    }

    const [evidenceCounts, investigationCounts, investigationRows] =
      await Promise.all([
        db
          .select({
            incidentId: sreEvidenceItems.incidentId,
            count: sql<number>`count(${sreEvidenceItems.id})::int`,
          })
          .from(sreEvidenceItems)
          .where(
            and(
              eq(sreEvidenceItems.organizationId, organizationId),
              eq(sreEvidenceItems.projectId, project.id),
              inArray(sreEvidenceItems.incidentId, incidentIds),
            ),
          )
          .groupBy(sreEvidenceItems.incidentId),
        db
          .select({
            incidentId: sreInvestigationRuns.incidentId,
            count: sql<number>`count(${sreInvestigationRuns.id})::int`,
          })
          .from(sreInvestigationRuns)
          .where(
            and(
              eq(sreInvestigationRuns.organizationId, organizationId),
              eq(sreInvestigationRuns.projectId, project.id),
              inArray(sreInvestigationRuns.incidentId, incidentIds),
            ),
          )
          .groupBy(sreInvestigationRuns.incidentId),
        db
          .select({
            incidentId: sreInvestigationRuns.incidentId,
            status: sreInvestigationRuns.status,
            completedAt: sreInvestigationRuns.completedAt,
            createdAt: sreInvestigationRuns.createdAt,
          })
          .from(sreInvestigationRuns)
          .where(
            and(
              eq(sreInvestigationRuns.organizationId, organizationId),
              eq(sreInvestigationRuns.projectId, project.id),
              inArray(sreInvestigationRuns.incidentId, incidentIds),
            ),
          )
          .orderBy(desc(sreInvestigationRuns.createdAt)),
      ]);

    const evidenceCountByIncidentId = new Map(
      evidenceCounts.flatMap((row) =>
        row.incidentId ? [[row.incidentId, row.count] as const] : [],
      ),
    );
    const investigationCountByIncidentId = new Map(
      investigationCounts.flatMap((row) =>
        row.incidentId ? [[row.incidentId, row.count] as const] : [],
      ),
    );
    const latestInvestigationByIncidentId = new Map<
      string,
      {
        status: SreInvestigationStatus;
        completedAt: Date | null;
        createdAt: Date;
      }
    >();

    for (const investigation of investigationRows) {
      if (
        investigation.incidentId &&
        !latestInvestigationByIncidentId.has(investigation.incidentId)
      ) {
        latestInvestigationByIncidentId.set(investigation.incidentId, {
          status: investigation.status,
          completedAt: investigation.completedAt,
          createdAt: investigation.createdAt,
        });
      }
    }

    return {
      success: true,
      incidents: rows.map((row) => {
        const latestInvestigation = latestInvestigationByIncidentId.get(row.id);

        return {
          ...row,
          evidenceCount: evidenceCountByIncidentId.get(row.id) ?? 0,
          investigationCount: investigationCountByIncidentId.get(row.id) ?? 0,
          latestInvestigationStatus: latestInvestigation?.status ?? null,
          latestInvestigationCompletedAt:
            latestInvestigation?.completedAt ?? null,
          latestInvestigationCreatedAt: latestInvestigation?.createdAt ?? null,
        };
      }),
    };
  } catch (error) {
    logger.error({ error }, "Error fetching SRE incidents");
    return {
      success: false,
      error: "Failed to fetch SRE incidents",
      incidents: [],
    };
  }
}

export async function getSreIncidentDetails(
  incidentId: string,
): Promise<
  | { success: true; detail: SreIncidentDetail }
  | { success: false; error: string; detail: null }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_incident", "view", {
      userId,
      organizationId,
      project,
    });
    const canUpdate = checkPermissionWithContext("sre_incident", "update", {
      userId,
      organizationId,
      project,
    });
    const canInvestigate =
      checkPermissionWithContext("sre_incident", "investigate", {
        userId,
        organizationId,
        project,
      }) &&
      checkPermissionWithContext("sre_investigation", "investigate", {
        userId,
        organizationId,
        project,
      });
    const canUseLiveConnectors =
      canInvestigate &&
      checkPermissionWithContext("sre_connector", "investigate", {
        userId,
        organizationId,
        project,
      });

    if (!canView) {
      return {
        success: false,
        error: "Insufficient permissions to view SRE incidents",
        detail: null,
      };
    }

    const [incident] = await db
      .select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        primaryServiceId: sreIncidents.primaryServiceId,
        primaryServiceName: sreServices.name,
        createdAt: sreIncidents.createdAt,
        updatedAt: sreIncidents.updatedAt,
        resolvedAt: sreIncidents.resolvedAt,
        rootCauseSummary: sreIncidents.rootCauseSummary,
        confidenceScore: sreIncidents.confidenceScore,
        alertCount: sql<number>`count(${sreIncidentAlerts.alertEventId})::int`,
      })
      .from(sreIncidents)
      .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
      .leftJoin(
        sreIncidentAlerts,
        eq(sreIncidentAlerts.incidentId, sreIncidents.id),
      )
      .where(
        and(
          eq(sreIncidents.id, incidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id),
        ),
      )
      .groupBy(
        sreIncidents.id,
        sreIncidents.incidentNumber,
        sreIncidents.title,
        sreIncidents.severity,
        sreIncidents.status,
        sreIncidents.primaryServiceId,
        sreServices.name,
        sreIncidents.createdAt,
        sreIncidents.updatedAt,
        sreIncidents.resolvedAt,
        sreIncidents.rootCauseSummary,
        sreIncidents.confidenceScore,
      )
      .limit(1);

    if (!incident) {
      return {
        success: false,
        error: "Incident not found or access denied",
        detail: null,
      };
    }

    const [latestBrief] = await db
      .select({
        id: sreInvestigationRuns.id,
        modelId: sreInvestigationRuns.modelId,
        status: sreInvestigationRuns.status,
        rootCauseHypothesis: sreInvestigationRuns.rootCauseHypothesis,
        confidenceScore: sreInvestigationRuns.confidenceScore,
        agentStateSnapshot: sreInvestigationRuns.agentStateSnapshot,
        completedAt: sreInvestigationRuns.completedAt,
        createdAt: sreInvestigationRuns.createdAt,
      })
      .from(sreInvestigationRuns)
      .where(
        and(
          eq(sreInvestigationRuns.incidentId, incidentId),
          eq(sreInvestigationRuns.organizationId, organizationId),
          eq(sreInvestigationRuns.projectId, project.id),
          eq(sreInvestigationRuns.agentType, "sre_ai"),
        ),
      )
      .orderBy(desc(sreInvestigationRuns.createdAt))
      .limit(1);

    const [latestInvestigation] = await db
      .select({
        id: sreInvestigationRuns.id,
        modelId: sreInvestigationRuns.modelId,
        status: sreInvestigationRuns.status,
        rootCauseHypothesis: sreInvestigationRuns.rootCauseHypothesis,
        agentStateSnapshot: sreInvestigationRuns.agentStateSnapshot,
        completedAt: sreInvestigationRuns.completedAt,
        createdAt: sreInvestigationRuns.createdAt,
      })
      .from(sreInvestigationRuns)
      .where(
        and(
          eq(sreInvestigationRuns.incidentId, incidentId),
          eq(sreInvestigationRuns.organizationId, organizationId),
          eq(sreInvestigationRuns.projectId, project.id),
          eq(sreInvestigationRuns.agentType, "investigation"),
        ),
      )
      .orderBy(desc(sreInvestigationRuns.createdAt))
      .limit(1);

    const latestReportSnapshot = latestInvestigation
      ? await db.query.sreInvestigationReports.findFirst({
          where: and(
            eq(sreInvestigationReports.organizationId, organizationId),
            eq(sreInvestigationReports.projectId, project.id),
            eq(
              sreInvestigationReports.investigationRunId,
              latestInvestigation.id,
            ),
            eq(sreInvestigationReports.status, "active"),
          ),
          columns: {
            id: true,
            title: true,
            createdAt: true,
            reportHash: true,
            investigationRunId: true,
          },
          orderBy: desc(sreInvestigationReports.createdAt),
        })
      : null;

    const myReportFeedback = latestReportSnapshot
      ? await db.query.sreInvestigationReportFeedback.findFirst({
          where: and(
            eq(sreInvestigationReportFeedback.organizationId, organizationId),
            eq(sreInvestigationReportFeedback.projectId, project.id),
            eq(sreInvestigationReportFeedback.reportId, latestReportSnapshot.id),
            eq(sreInvestigationReportFeedback.createdByUserId, userId),
          ),
          columns: {
            accuracy: true,
            notes: true,
            rejectedHypotheses: true,
            updatedAt: true,
          },
        })
      : null;

    const [evidence, investigationCountRow, toolMetricsRow] = await Promise.all(
      [
        db
          .select({
            id: sreEvidenceItems.id,
            title: sreEvidenceItems.title,
            summary: sreEvidenceItems.summary,
            sourceUri: sreEvidenceItems.sourceUri,
            evidenceType: sreEvidenceItems.evidenceType,
            severity: sreEvidenceItems.severity,
            confidence: sreEvidenceItems.confidence,
            rawContentExcerpt: sreEvidenceItems.rawContentExcerpt,
            citationQuery: sreEvidenceItems.citationQuery,
            observedAt: sreEvidenceItems.observedAt,
            createdAt: sreEvidenceItems.createdAt,
          })
          .from(sreEvidenceItems)
          .where(
            and(
              eq(sreEvidenceItems.incidentId, incidentId),
              eq(sreEvidenceItems.organizationId, organizationId),
              eq(sreEvidenceItems.projectId, project.id),
            ),
          )
          .orderBy(
            desc(sreEvidenceItems.observedAt),
            desc(sreEvidenceItems.createdAt),
          ),
        db
          .select({
            count: sql<number>`count(${sreInvestigationRuns.id})::int`,
          })
          .from(sreInvestigationRuns)
          .where(
            and(
              eq(sreInvestigationRuns.incidentId, incidentId),
              eq(sreInvestigationRuns.organizationId, organizationId),
              eq(sreInvestigationRuns.projectId, project.id),
              eq(sreInvestigationRuns.agentType, "investigation"),
            ),
          )
          .limit(1),
        db
          .select({
            total: sql<number>`count(${sreInvestigationToolCalls.id})::int`,
            errors: sql<number>`count(${sreInvestigationToolCalls.id}) filter (where ${sreInvestigationToolCalls.status} = 'error')::int`,
            averageDurationMs: sql<number>`coalesce(avg(${sreInvestigationToolCalls.durationMs}), 0)::int`,
          })
          .from(sreInvestigationRuns)
          .leftJoin(
            sreInvestigationToolCalls,
            eq(
              sreInvestigationToolCalls.investigationRunId,
              sreInvestigationRuns.id,
            ),
          )
          .where(
            and(
              eq(sreInvestigationRuns.incidentId, incidentId),
              eq(sreInvestigationRuns.organizationId, organizationId),
              eq(sreInvestigationRuns.projectId, project.id),
              eq(sreInvestigationRuns.agentType, "investigation"),
            ),
          )
          .limit(1),
      ],
    );

    const recentConversations = await listSreConversations({
      organizationId,
      projectId: project.id,
      userId,
      incidentId,
      limit: 5,
    });

    const chatHistories = await Promise.all(
      recentConversations.map((conversation) =>
        getConversationHistory({
          organizationId,
          projectId: project.id,
          userId,
          conversationId: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
        }),
      ),
    );
    const chatHistory = chatHistories[0] ?? null;

    return {
      success: true,
      detail: {
        incident: {
          ...incident,
          evidenceCount: evidence.length,
          investigationCount: investigationCountRow[0]?.count ?? 0,
          latestInvestigationStatus: latestInvestigation?.status ?? null,
          latestInvestigationCompletedAt:
            latestInvestigation?.completedAt ?? null,
          latestInvestigationCreatedAt: latestInvestigation?.createdAt ?? null,
        },
        latestBrief: latestBrief ?? null,
        latestInvestigation: latestInvestigation
          ? {
              id: latestInvestigation.id,
              modelId: latestInvestigation.modelId,
              status: latestInvestigation.status,
              summary:
                typeof latestInvestigation.agentStateSnapshot?.summary ===
                "string"
                  ? latestInvestigation.agentStateSnapshot.summary
                  : latestInvestigation.rootCauseHypothesis,
              completedAt: latestInvestigation.completedAt,
              createdAt: latestInvestigation.createdAt,
            }
          : null,
        latestReportSnapshot: latestReportSnapshot ?? null,
        myReportFeedback: myReportFeedback ?? null,
        evidence,
        chatHistory,
        chatHistories,
        toolMetrics: {
          total: toolMetricsRow[0]?.total ?? 0,
          errors: toolMetricsRow[0]?.errors ?? 0,
          averageDurationMs: toolMetricsRow[0]?.averageDurationMs ?? 0,
        },
        permissions: {
          canUpdate,
          canInvestigate,
          canUseLiveConnectors,
        },
        capabilities: {
          investigationEnabled: isSreInvestigationAgentEnabled(),
        },
      },
    };
  } catch (error) {
    logger.error({ error }, "Error fetching SRE incident details");
    return {
      success: false,
      error: "Failed to fetch SRE incident",
      detail: null,
    };
  }
}

export async function archiveSreIncidentChatConversation(
  input: z.infer<typeof archiveIncidentChatSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const parsed = archiveIncidentChatSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid SRE chat archive request" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext(
      "sre_investigation",
      "investigate",
      {
        userId,
        organizationId,
        project,
      },
    );

    if (!canInvestigate) {
      return {
        success: false,
        error: "Insufficient permissions to archive SRE chat conversations",
      };
    }

    const conversation = await getSreConversation({
      organizationId,
      projectId: project.id,
      userId,
      conversationId: parsed.data.conversationId,
    });

    if (conversation.incidentId !== parsed.data.incidentId) {
      return {
        success: false,
        error: "Conversation does not belong to this incident",
      };
    }

    await archiveSreConversation({
      organizationId,
      projectId: project.id,
      userId,
      conversationId: parsed.data.conversationId,
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_incident_chat_archived",
      resource: "sre_chat_conversation",
      resourceId: parsed.data.conversationId,
      metadata: { projectId: project.id, incidentId: parsed.data.incidentId },
      success: true,
    });

    revalidatePath(`/incidents/${parsed.data.incidentId}`);

    return { success: true };
  } catch (error) {
    logger.error({ error }, "Error archiving SRE incident chat conversation");
    return { success: false, error: "Failed to archive SRE chat conversation" };
  }
}

export async function createManualSreIncident(
  input: z.infer<typeof createManualIncidentSchema>,
): Promise<CreateManualSreIncidentResult> {
  try {
    const parsed = createManualIncidentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid incident details",
        fieldErrors: formatValidationErrors(parsed.error),
      };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canCreate = checkPermissionWithContext("sre_incident", "create", {
      userId,
      organizationId,
      project,
    });

    if (!canCreate) {
      return {
        success: false,
        error: "Insufficient permissions to create incidents",
      };
    }

    const title = truncate(parsed.data.title, 500);
    const summary = parsed.data.summary?.trim() || null;
    const now = new Date();

    const incident = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`,
      );

      const [numberRow] = await tx
        .select({
          nextIncidentNumber: sql<number>`coalesce(max(${sreIncidents.incidentNumber}), 0) + 1`,
        })
        .from(sreIncidents)
        .where(eq(sreIncidents.organizationId, organizationId));

      const incidentNumber = Number(numberRow?.nextIncidentNumber ?? 1);

      const [created] = await tx
        .insert(sreIncidents)
        .values({
          organizationId,
          projectId: project.id,
          incidentNumber,
          title,
          severity: parsed.data.severity,
          status: "triggered",
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
        });

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: created.id,
        eventType: "state_change",
        eventData: {
          state: "manual_incident_created",
          summary,
        },
        actorType: "user",
        actorUserId: userId,
        createdAt: now,
      });

      return created;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_incident_created_manual",
      resource: "sre_incident",
      resourceId: incident.id,
      metadata: {
        projectId: project.id,
        incidentNumber: incident.incidentNumber,
        severity: parsed.data.severity,
      },
      success: true,
    });

    revalidatePath("/incidents");
    revalidatePath(`/incidents/${incident.id}`);

    return {
      success: true,
      incident,
      message: `Incident #${incident.incidentNumber} created`,
    };
  } catch (error) {
    logger.error({ error }, "Error creating manual SRE incident");
    return { success: false, error: "Failed to create incident" };
  }
}

export async function updateSreIncident(
  input: z.infer<typeof updateIncidentSchema>,
): Promise<UpdateSreIncidentResult> {
  try {
    const parsed = updateIncidentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid incident details",
        fieldErrors: formatValidationErrors(parsed.error),
      };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canUpdate = checkPermissionWithContext("sre_incident", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      return {
        success: false,
        error: "Insufficient permissions to update incidents",
      };
    }

    const current = await db.query.sreIncidents.findFirst({
      where: and(
        eq(sreIncidents.id, parsed.data.id),
        eq(sreIncidents.organizationId, organizationId),
        eq(sreIncidents.projectId, project.id),
      ),
    });

    if (!current) {
      return { success: false, error: "Incident not found or access denied" };
    }

    if (parsed.data.primaryServiceId) {
      const service = await db.query.sreServices.findFirst({
        where: and(
          eq(sreServices.id, parsed.data.primaryServiceId),
          eq(sreServices.organizationId, organizationId),
          eq(sreServices.projectId, project.id),
        ),
      });

      if (!service || service.status === "merged") {
        return {
          success: false,
          error: "Selected service is not available for this project",
          fieldErrors: { primaryServiceId: ["Select a valid service"] },
        };
      }
    }

    const now = new Date();
    const incident = await db.transaction(async (tx) => {
      const [updatedIncident] = await tx
        .update(sreIncidents)
        .set({
          title: truncate(parsed.data.title, 500),
          severity: parsed.data.severity,
          status: parsed.data.status,
          primaryServiceId: parsed.data.primaryServiceId,
          resolvedAt:
            parsed.data.status === "resolved"
              ? (current.resolvedAt ?? now)
              : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sreIncidents.id, parsed.data.id),
            eq(sreIncidents.organizationId, organizationId),
            eq(sreIncidents.projectId, project.id),
          ),
        )
        .returning({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
        });

      if (!updatedIncident) {
        throw new Error("Incident was updated or deleted by another request");
      }

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: parsed.data.id,
        eventType: "state_change",
        eventData: {
          state: "incident_updated",
          previous: {
            title: current.title,
            severity: current.severity,
            status: current.status,
            primaryServiceId: current.primaryServiceId,
          },
          current: {
            title: parsed.data.title,
            severity: parsed.data.severity,
            status: parsed.data.status,
            primaryServiceId: parsed.data.primaryServiceId,
          },
        },
        actorType: "user",
        actorUserId: userId,
        createdAt: now,
      });

      return updatedIncident;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_incident_updated",
      resource: "sre_incident",
      resourceId: parsed.data.id,
      metadata: {
        projectId: project.id,
        incidentNumber: incident.incidentNumber,
        severity: parsed.data.severity,
        status: parsed.data.status,
        primaryServiceId: parsed.data.primaryServiceId,
      },
      success: true,
    });

    revalidatePath("/incidents");
    revalidatePath(`/incidents/${parsed.data.id}`);

    return {
      success: true,
      incident,
      message: `Incident #${incident.incidentNumber} updated`,
    };
  } catch (error) {
    logger.error({ error }, "Error updating SRE incident");
    return { success: false, error: "Failed to update incident" };
  }
}

export async function createSreIncidentFromAlert(
  input: z.infer<typeof createIncidentFromAlertSchema>,
): Promise<CreateSreIncidentFromAlertResult> {
  try {
    const parsed = createIncidentFromAlertSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid alert ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canCreate = checkPermissionWithContext("sre_incident", "create", {
      userId,
      organizationId,
      project,
    });

    if (!canCreate) {
      return {
        success: false,
        error: "Insufficient permissions to create SRE incidents",
      };
    }

    const [alert] = await db
      .select({
        id: alertHistory.id,
        targetType: alertHistory.targetType,
        target: alertHistory.target,
        monitorId: alertHistory.monitorId,
        jobId: alertHistory.jobId,
        type: alertHistory.type,
        message: alertHistory.message,
        status: alertHistory.status,
        provider: alertHistory.provider,
        sentAt: alertHistory.sentAt,
        deliveryMetadata: alertHistory.deliveryMetadata,
        monitorName: monitors.name,
        jobName: jobs.name,
      })
      .from(alertHistory)
      .leftJoin(monitors, eq(alertHistory.monitorId, monitors.id))
      .leftJoin(jobs, eq(alertHistory.jobId, jobs.id))
      .where(
        and(
          eq(alertHistory.id, parsed.data.alertHistoryId),
          or(
            and(
              eq(monitors.organizationId, organizationId),
              eq(monitors.projectId, project.id),
            ),
            and(
              eq(jobs.organizationId, organizationId),
              eq(jobs.projectId, project.id),
            ),
          ),
        ),
      )
      .limit(1);

    if (!alert) {
      return { success: false, error: "Alert not found or access denied" };
    }

    if (
      !isActionableAlertForIncident(alert.status, alert.type, alert.message)
    ) {
      return {
        success: false,
        error: "Only sent failure alerts can create incidents",
      };
    }

    const sourceType: SreAlertSourceType = alert.monitorId ? "monitor" : "job";
    const sourceId = alert.monitorId ?? alert.jobId;
    const targetName = alert.monitorName ?? alert.jobName ?? alert.target;
    const severity = deriveSeverity(alert.type, alert.message);
    const alertStatus = deriveAlertStatus(alert.type);
    const firedAt = alert.sentAt ?? new Date();
    const deliveryDedupKey =
      typeof alert.deliveryMetadata?.correlation?.dedupKey === "string" &&
      alert.deliveryMetadata.correlation.dedupKey.trim().length > 0
        ? alert.deliveryMetadata.correlation.dedupKey.trim()
        : undefined;
    const dedupKey =
      deliveryDedupKey ??
      [project.id, sourceType, sourceId ?? targetName, alert.type].join(":");
    const fingerprintHash = sha256(`${organizationId}:${dedupKey}`);
    const title = truncate(`${targetName}: ${titleCase(alert.type)}`, 500);

    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`,
      );

      const [mappedService] = sourceId
        ? await tx
            .select({ id: sreServices.id })
            .from(sreServiceResources)
            .innerJoin(
              sreServices,
              eq(sreServiceResources.serviceId, sreServices.id),
            )
            .where(
              and(
                eq(sreServiceResources.resourceType, sourceType),
                eq(sreServiceResources.resourceId, sourceId),
                eq(sreServices.organizationId, organizationId),
                eq(sreServices.projectId, project.id),
                eq(sreServices.status, "active"),
              ),
            )
            .limit(1)
        : [];

      const [existingAlertEvent] = await tx
        .select({ id: sreAlertEvents.id })
        .from(sreAlertEvents)
        .where(
          and(
            eq(sreAlertEvents.organizationId, organizationId),
            eq(sreAlertEvents.projectId, project.id),
            eq(sreAlertEvents.fingerprintHash, fingerprintHash),
          ),
        )
        .limit(1);

      const alertEvent = existingAlertEvent
        ? existingAlertEvent
        : (
            await tx
              .insert(sreAlertEvents)
              .values({
                organizationId,
                projectId: project.id,
                fingerprintHash,
                dedupKey,
                severity,
                status: alertStatus,
                sourceType,
                sourceId,
                serviceId: mappedService?.id ?? null,
                title,
                description: alert.message,
                firedAt,
                resolvedAt: alertStatus === "resolved" ? firedAt : null,
                createdAt: new Date(),
              })
              .returning({ id: sreAlertEvents.id })
          )[0];

      const [existingIncident] = await tx
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
        })
        .from(sreIncidentAlerts)
        .innerJoin(
          sreIncidents,
          eq(sreIncidentAlerts.incidentId, sreIncidents.id),
        )
        .where(eq(sreIncidentAlerts.alertEventId, alertEvent.id))
        .orderBy(desc(sreIncidents.createdAt))
        .limit(1);

      if (existingIncident) {
        return { incident: existingIncident, existing: true };
      }

      if (isSreAlertCorrelationEnabled()) {
        const correlatedIncident = await tx
          .transaction(async (correlationTx) => {
            const windowStart = new Date(
              firedAt.getTime() -
                ALERT_CORRELATION_LIMITS.windowMinutes * 60_000,
            );
            const [candidateRows, dependencyRows] = await Promise.all([
              correlationTx
                .select({
                  incidentId: sreIncidents.id,
                  incidentNumber: sreIncidents.incidentNumber,
                  incidentTitle: sreIncidents.title,
                  fingerprintHash: sreAlertEvents.fingerprintHash,
                  dedupKey: sreAlertEvents.dedupKey,
                  serviceId: sreAlertEvents.serviceId,
                  sourceType: sreAlertEvents.sourceType,
                  title: sreAlertEvents.title,
                  description: sreAlertEvents.description,
                  firedAt: sreAlertEvents.firedAt,
                })
                .from(sreIncidentAlerts)
                .innerJoin(
                  sreIncidents,
                  eq(sreIncidentAlerts.incidentId, sreIncidents.id),
                )
                .innerJoin(
                  sreAlertEvents,
                  eq(sreIncidentAlerts.alertEventId, sreAlertEvents.id),
                )
                .where(
                  and(
                    eq(sreIncidents.organizationId, organizationId),
                    eq(sreIncidents.projectId, project.id),
                    ne(sreIncidents.status, "resolved"),
                    ne(sreAlertEvents.id, alertEvent.id),
                    gte(sreAlertEvents.firedAt, windowStart),
                  ),
                )
                .orderBy(desc(sreAlertEvents.firedAt))
                .limit(ALERT_CORRELATION_LIMITS.candidateLimit),
              mappedService?.id
                ? correlationTx
                    .select({
                      sourceServiceId: sreServiceDependencies.sourceServiceId,
                      targetServiceId: sreServiceDependencies.targetServiceId,
                    })
                    .from(sreServiceDependencies)
                    .where(
                      and(
                        eq(
                          sreServiceDependencies.organizationId,
                          organizationId,
                        ),
                        eq(sreServiceDependencies.projectId, project.id),
                        eq(sreServiceDependencies.status, "active"),
                        isNotNull(sreServiceDependencies.approvedAt),
                        or(
                          eq(
                            sreServiceDependencies.sourceServiceId,
                            mappedService.id,
                          ),
                          eq(
                            sreServiceDependencies.targetServiceId,
                            mappedService.id,
                          ),
                        ),
                      ),
                    )
                : Promise.resolve([]),
            ]);
            const relatedServiceIds = new Set(
              dependencyRows
                .flatMap((dependency) => [
                  dependency.sourceServiceId,
                  dependency.targetServiceId,
                ])
                .filter((serviceId) => serviceId !== mappedService?.id),
            );
            const correlation = selectAlertCorrelationMatch({
              alert: {
                fingerprintHash,
                dedupKey,
                serviceId: mappedService?.id ?? null,
                sourceType,
                title,
                description: alert.message,
                firedAt,
              },
              candidates: candidateRows,
              approvedRelatedServiceIds: relatedServiceIds,
            });

            if (!correlation) return null;

            await correlationTx
              .insert(sreIncidentAlerts)
              .values({
                incidentId: correlation.candidate.incidentId,
                alertEventId: alertEvent.id,
                role: "related",
                createdAt: new Date(),
              })
              .onConflictDoNothing();

            await correlationTx.insert(sreIncidentTimelineEvents).values({
              incidentId: correlation.candidate.incidentId,
              eventType: "state_change",
              eventData: {
                state: "alert_correlated",
                alertEventId: alertEvent.id,
                alertHistoryId: alert.id,
                score: correlation.score,
                signals: correlation.signals,
                correlationVersion: 1,
              },
              actorType: "system",
              createdAt: new Date(),
            });

            return {
              incident: {
                id: correlation.candidate.incidentId,
                incidentNumber: correlation.candidate.incidentNumber,
                title: correlation.candidate.incidentTitle,
              },
              existing: true,
              correlation: {
                score: correlation.score,
                signals: correlation.signals,
              },
            };
          })
          .catch((error) => {
            logger.warn(
              { error },
              "SRE alert correlation failed; falling back to normal incident creation",
            );
            return null;
          });

        if (correlatedIncident) return correlatedIncident;
      }

      const [numberRow] = await tx
        .select({
          nextIncidentNumber: sql<number>`coalesce(max(${sreIncidents.incidentNumber}), 0) + 1`,
        })
        .from(sreIncidents)
        .where(eq(sreIncidents.organizationId, organizationId));

      const incidentNumber = Number(numberRow?.nextIncidentNumber ?? 1);

      const [incident] = await tx
        .insert(sreIncidents)
        .values({
          organizationId,
          projectId: project.id,
          incidentNumber,
          title,
          severity,
          status: alertStatus === "resolved" ? "resolved" : "triggered",
          primaryServiceId: mappedService?.id ?? null,
          resolvedAt: alertStatus === "resolved" ? firedAt : null,
          createdByUserId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
        });

      await tx.insert(sreIncidentAlerts).values({
        incidentId: incident.id,
        alertEventId: alertEvent.id,
        role: "trigger",
        createdAt: new Date(),
      });

      await tx.insert(sreIncidentTimelineEvents).values({
        incidentId: incident.id,
        eventType: "state_change",
        eventData: {
          state: "created_from_alert_history",
          alertHistoryId: alert.id,
          alertStatus: alert.status,
          alertProvider: alert.provider,
          alertType: alert.type,
          sourceType,
          sourceId,
          targetName,
          fingerprintHash,
        },
        actorType: "user",
        actorUserId: userId,
        createdAt: new Date(),
      });

      return { incident, existing: false };
    });

    const correlation = "correlation" in result ? result.correlation : null;

    await logAuditEvent({
      userId,
      organizationId,
      action: correlation
        ? "sre_alert_correlated_to_incident"
        : result.existing
          ? "sre_incident_reused_from_alert"
          : "sre_incident_created_from_alert",
      resource: "sre_incident",
      resourceId: result.incident.id,
      metadata: {
        projectId: project.id,
        alertHistoryId: alert.id,
        incidentNumber: result.incident.incidentNumber,
        fingerprintHash,
        ...(correlation
          ? {
              correlationScore: correlation.score,
              correlationSignals: correlation.signals,
              correlationVersion: 1,
            }
          : {}),
      },
      success: true,
    });

    const triage = await maybeRunAutomaticSreTriage({
      userId,
      organizationId,
      project: {
        id: project.id,
        userRole: project.userRole,
      },
      incidentId: result.incident.id,
      existingIncident: result.existing,
      alertStatus,
    });

    revalidatePath("/alerts");
    revalidatePath("/incidents");
    revalidatePath(`/incidents/${result.incident.id}`);

    return {
      success: true,
      incident: result.incident,
      triage,
      existing: result.existing,
      message: result.existing
        ? `Incident #${result.incident.incidentNumber} already tracks this alert`
        : `Incident #${result.incident.incidentNumber} created`,
    };
  } catch (error) {
    logger.error({ error }, "Error creating SRE incident from alert");
    return { success: false, error: "Failed to create SRE incident" };
  }
}
