"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq, or, sql } from "drizzle-orm";
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
  sreServices,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { archiveSreConversation, getSreConversation, listSreConversations, listSreMessages } from "@/sre/lib/session-store";
import { maybeRunAutomaticSreTriage, type AutomaticSreTriageResult } from "@/sre/lib/triage-automation";
import { db } from "@/utils/db";

const createIncidentFromAlertSchema = z.object({
  alertHistoryId: z.string().uuid(),
});

const archiveIncidentChatSchema = z.object({
  incidentId: z.string().uuid(),
  conversationId: z.string().uuid(),
});

type SreSeverity = "sev1" | "sev2" | "sev3" | "sev4";
type SreAlertStatus = "firing" | "resolved";
type SreAlertSourceType = "monitor" | "job";

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
  primaryServiceName: string | null;
  alertCount: number;
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
};

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  return normalizedType.includes("recovery") || normalizedType.includes("success")
    ? "resolved"
    : "firing";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
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
      if ((message.role !== "user" && message.role !== "assistant") || !message.content) {
        return [];
      }

      return [{
        id: message.id,
        role: message.role,
        content: message.content,
        modelId: message.modelId,
      }];
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
      return { success: false, error: "Insufficient permissions to view SRE incidents", incidents: [] };
    }

    const rows = await db
      .select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
        primaryServiceName: sreServices.name,
        createdAt: sreIncidents.createdAt,
        updatedAt: sreIncidents.updatedAt,
        resolvedAt: sreIncidents.resolvedAt,
        alertCount: sql<number>`count(${sreIncidentAlerts.alertEventId})::int`,
      })
      .from(sreIncidents)
      .leftJoin(sreServices, eq(sreIncidents.primaryServiceId, sreServices.id))
      .leftJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
      .where(
        and(
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id)
        )
      )
      .groupBy(
        sreIncidents.id,
        sreIncidents.incidentNumber,
        sreIncidents.title,
        sreIncidents.severity,
        sreIncidents.status,
        sreServices.name,
        sreIncidents.createdAt,
        sreIncidents.updatedAt,
        sreIncidents.resolvedAt
      )
      .orderBy(desc(sreIncidents.updatedAt));

    return { success: true, incidents: rows };
  } catch (error) {
    console.error("Error fetching SRE incidents:", error);
    return { success: false, error: "Failed to fetch SRE incidents", incidents: [] };
  }
}

export async function getSreIncidentDetails(
  incidentId: string
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

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view SRE incidents", detail: null };
    }

    const [incident] = await db
      .select({
        id: sreIncidents.id,
        incidentNumber: sreIncidents.incidentNumber,
        title: sreIncidents.title,
        severity: sreIncidents.severity,
        status: sreIncidents.status,
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
      .leftJoin(sreIncidentAlerts, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
      .where(
        and(
          eq(sreIncidents.id, incidentId),
          eq(sreIncidents.organizationId, organizationId),
          eq(sreIncidents.projectId, project.id)
        )
      )
      .groupBy(
        sreIncidents.id,
        sreIncidents.incidentNumber,
        sreIncidents.title,
        sreIncidents.severity,
        sreIncidents.status,
        sreServices.name,
        sreIncidents.createdAt,
        sreIncidents.updatedAt,
        sreIncidents.resolvedAt,
        sreIncidents.rootCauseSummary,
        sreIncidents.confidenceScore
      )
      .limit(1);

    if (!incident) {
      return { success: false, error: "Incident not found or access denied", detail: null };
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
      .where(and(
        eq(sreInvestigationRuns.incidentId, incidentId),
        eq(sreInvestigationRuns.organizationId, organizationId),
        eq(sreInvestigationRuns.projectId, project.id)
      ))
      .orderBy(desc(sreInvestigationRuns.createdAt))
      .limit(1);

    const evidence = await db
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
      .where(and(
        eq(sreEvidenceItems.incidentId, incidentId),
        eq(sreEvidenceItems.organizationId, organizationId),
        eq(sreEvidenceItems.projectId, project.id)
      ))
      .orderBy(desc(sreEvidenceItems.observedAt), desc(sreEvidenceItems.createdAt));

    const recentConversations = await listSreConversations({
      organizationId,
      projectId: project.id,
      userId,
      incidentId,
      limit: 5,
    });

    const chatHistories = await Promise.all(
      recentConversations.map((conversation) => getConversationHistory({
        organizationId,
        projectId: project.id,
        userId,
        conversationId: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
      }))
    );
    const chatHistory = chatHistories[0] ?? null;

    return { success: true, detail: { incident, latestBrief: latestBrief ?? null, evidence, chatHistory, chatHistories } };
  } catch (error) {
    console.error("Error fetching SRE incident details:", error);
    return { success: false, error: "Failed to fetch SRE incident", detail: null };
  }
}

export async function archiveSreIncidentChatConversation(
  input: z.infer<typeof archiveIncidentChatSchema>
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const parsed = archiveIncidentChatSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid SRE chat archive request" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false, error: "Insufficient permissions to archive SRE chat conversations" };
    }

    const conversation = await getSreConversation({
      organizationId,
      projectId: project.id,
      userId,
      conversationId: parsed.data.conversationId,
    });

    if (conversation.incidentId !== parsed.data.incidentId) {
      return { success: false, error: "Conversation does not belong to this incident" };
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
    console.error("Error archiving SRE incident chat conversation:", error);
    return { success: false, error: "Failed to archive SRE chat conversation" };
  }
}

export async function createSreIncidentFromAlert(
  input: z.infer<typeof createIncidentFromAlertSchema>
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
      return { success: false, error: "Insufficient permissions to create SRE incidents" };
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
              eq(monitors.projectId, project.id)
            ),
            and(eq(jobs.organizationId, organizationId), eq(jobs.projectId, project.id))
          )
        )
      )
      .limit(1);

    if (!alert) {
      return { success: false, error: "Alert not found or access denied" };
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
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);

      const [existingAlertEvent] = await tx
        .select({ id: sreAlertEvents.id })
        .from(sreAlertEvents)
        .where(
          and(
            eq(sreAlertEvents.organizationId, organizationId),
            eq(sreAlertEvents.projectId, project.id),
            eq(sreAlertEvents.fingerprintHash, fingerprintHash)
          )
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
        .innerJoin(sreIncidents, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
        .where(eq(sreIncidentAlerts.alertEventId, alertEvent.id))
        .orderBy(desc(sreIncidents.createdAt))
        .limit(1);

      if (existingIncident) {
        return { incident: existingIncident, existing: true };
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

    await logAuditEvent({
      userId,
      organizationId,
      action: result.existing ? "sre_incident_reused_from_alert" : "sre_incident_created_from_alert",
      resource: "sre_incident",
      resourceId: result.incident.id,
      metadata: {
        projectId: project.id,
        alertHistoryId: alert.id,
        incidentNumber: result.incident.incidentNumber,
        fingerprintHash,
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
    if (triage.attempted) {
      revalidatePath("/incidents");
      revalidatePath(`/incidents/${result.incident.id}`);
    }

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
    console.error("Error creating SRE incident from alert:", error);
    return { success: false, error: "Failed to create SRE incident" };
  }
}
