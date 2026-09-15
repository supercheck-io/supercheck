import { createHash } from "crypto";
import { and, desc, eq, gte, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  alertHistory,
  jobs,
  monitors,
  sreAlertEvents,
  sreIncidentAlerts,
  sreIncidents,
  sreIncidentTimelineEvents,
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
import {
  isSreAlertCorrelationEnabled,
  isSreBackgroundAlertTriageEnabled,
} from "@/sre/lib/feature-gates";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-background-alert-triage" }) as {
  warn: (data: unknown, message?: string) => void;
};

const backgroundTriageJobSchema = z.object({
  alertHistoryId: z.string().uuid(),
});

type SreSeverity = "sev1" | "sev2" | "sev3" | "sev4";
type SreAlertStatus = "firing" | "resolved";
type SreAlertSourceType = "monitor" | "job";

export type SreBackgroundAlertTriageJob = z.infer<
  typeof backgroundTriageJobSchema
>;

export type SreBackgroundAlertTriageResult =
  | {
      success: true;
      skipped: false;
      incidentId: string;
      investigationRunId: string;
      alertEventId: string;
    }
  | {
      success: true;
      skipped: true;
      reason:
        | "disabled"
        | "invalid_job"
        | "alert_not_found"
        | "non_sent_alert"
        | "resolved_alert"
        | "already_triaged"
        | "unsupported_source";
    }
  | {
      success: false;
      error: string;
      incidentId?: string;
      investigationRunId?: string;
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
  return normalizedType.includes("recovery") ||
    normalizedType.includes("success")
    ? "resolved"
    : "firing";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

async function createOrGetIncidentForAlertHistory(alertHistoryId: string) {
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
      monitorOrganizationId: monitors.organizationId,
      monitorProjectId: monitors.projectId,
      jobName: jobs.name,
      jobOrganizationId: jobs.organizationId,
      jobProjectId: jobs.projectId,
    })
    .from(alertHistory)
    .leftJoin(monitors, eq(alertHistory.monitorId, monitors.id))
    .leftJoin(jobs, eq(alertHistory.jobId, jobs.id))
    .where(eq(alertHistory.id, alertHistoryId))
    .limit(1);

  if (!alert) {
    return { skipped: true as const, reason: "alert_not_found" as const };
  }

  if (alert.status !== "sent") {
    return { skipped: true as const, reason: "non_sent_alert" as const };
  }

  const alertStatus = deriveAlertStatus(alert.type);
  if (alertStatus !== "firing") {
    return { skipped: true as const, reason: "resolved_alert" as const };
  }

  const organizationId = alert.monitorOrganizationId ?? alert.jobOrganizationId;
  const projectId = alert.monitorProjectId ?? alert.jobProjectId;
  const sourceType: SreAlertSourceType | null = alert.monitorId
    ? "monitor"
    : alert.jobId
      ? "job"
      : null;
  const sourceId = alert.monitorId ?? alert.jobId;

  if (!organizationId || !projectId || !sourceType || !sourceId) {
    return { skipped: true as const, reason: "unsupported_source" as const };
  }

  const targetName = alert.monitorName ?? alert.jobName ?? alert.target;
  const severity = deriveSeverity(alert.type, alert.message);
  const firedAt = alert.sentAt ?? new Date();
  const deliveryDedupKey =
    typeof alert.deliveryMetadata?.correlation?.dedupKey === "string" &&
    alert.deliveryMetadata.correlation.dedupKey.trim().length > 0
      ? alert.deliveryMetadata.correlation.dedupKey.trim()
      : undefined;
  const dedupKey =
    deliveryDedupKey ?? [projectId, sourceType, sourceId, alert.type].join(":");
  const fingerprintHash = sha256(`${organizationId}:${dedupKey}`);
  const title = truncate(`${targetName}: ${titleCase(alert.type)}`, 500);

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`,
    );

    const [mappedService] = await tx
      .select({ id: sreServices.id })
      .from(sreServiceResources)
      .innerJoin(sreServices, eq(sreServiceResources.serviceId, sreServices.id))
      .where(
        and(
          eq(sreServiceResources.resourceType, sourceType),
          eq(sreServiceResources.resourceId, sourceId),
          eq(sreServices.organizationId, organizationId),
          eq(sreServices.projectId, projectId),
          eq(sreServices.status, "active"),
        ),
      )
      .limit(1);

    const [existingAlertEvent] = await tx
      .select({ id: sreAlertEvents.id })
      .from(sreAlertEvents)
      .where(
        and(
          eq(sreAlertEvents.organizationId, organizationId),
          eq(sreAlertEvents.projectId, projectId),
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
              projectId,
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
              createdAt: new Date(),
            })
            .returning({ id: sreAlertEvents.id })
        )[0];

    const [existingIncident] = await tx
      .select({
        id: sreIncidents.id,
        triageInvestigationRunId: sreIncidents.triageInvestigationRunId,
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
      return {
        skipped: false as const,
        organizationId,
        projectId,
        alertEventId: alertEvent.id,
        incidentId: existingIncident.id,
        alreadyTriaged: Boolean(existingIncident.triageInvestigationRunId),
      };
    }

    if (isSreAlertCorrelationEnabled()) {
      const correlatedIncident = await tx
        .transaction(async (correlationTx) => {
          const windowStart = new Date(
            firedAt.getTime() - ALERT_CORRELATION_LIMITS.windowMinutes * 60_000,
          );
          const [candidateRows, dependencyRows] = await Promise.all([
            correlationTx
              .select({
                incidentId: sreIncidents.id,
                incidentNumber: sreIncidents.incidentNumber,
                incidentTitle: sreIncidents.title,
                triageInvestigationRunId: sreIncidents.triageInvestigationRunId,
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
                  eq(sreIncidents.projectId, projectId),
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
                      eq(sreServiceDependencies.organizationId, organizationId),
                      eq(sreServiceDependencies.projectId, projectId),
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
            skipped: false as const,
            organizationId,
            projectId,
            alertEventId: alertEvent.id,
            incidentId: correlation.candidate.incidentId,
            alreadyTriaged: Boolean(
              candidateRows.find(
                (candidate) =>
                  candidate.incidentId === correlation.candidate.incidentId,
              )?.triageInvestigationRunId,
            ),
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

    const [incident] = await tx
      .insert(sreIncidents)
      .values({
        organizationId,
        projectId,
        incidentNumber: Number(numberRow?.nextIncidentNumber ?? 1),
        title,
        severity,
        status: "triggered",
        primaryServiceId: mappedService?.id ?? null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: sreIncidents.id });

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
        state: "created_from_background_alert_triage",
        alertHistoryId: alert.id,
        alertProvider: alert.provider,
        alertType: alert.type,
        sourceType,
        sourceId,
        targetName,
        fingerprintHash,
      },
      actorType: "system",
      createdAt: new Date(),
    });

    return {
      skipped: false as const,
      organizationId,
      projectId,
      alertEventId: alertEvent.id,
      incidentId: incident.id,
      alreadyTriaged: false,
    };
  });

  if ("correlation" in result && result.correlation) {
    await logAuditEvent({
      organizationId,
      action: "sre_alert_correlated_to_incident",
      resource: "sre_incident",
      resourceId: result.incidentId,
      metadata: {
        projectId,
        alertHistoryId: alert.id,
        alertEventId: result.alertEventId,
        correlationScore: result.correlation.score,
        correlationSignals: result.correlation.signals,
        correlationVersion: 1,
      },
      success: true,
    });
  }

  return result;
}

export async function processSreBackgroundAlertTriageJob(
  jobData: unknown,
): Promise<SreBackgroundAlertTriageResult> {
  if (!isSreBackgroundAlertTriageEnabled()) {
    return { success: true, skipped: true, reason: "disabled" };
  }

  const parsed = backgroundTriageJobSchema.safeParse(jobData);
  if (!parsed.success) {
    return { success: true, skipped: true, reason: "invalid_job" };
  }

  const incident = await createOrGetIncidentForAlertHistory(
    parsed.data.alertHistoryId,
  );
  if (incident.skipped) {
    return { success: true, skipped: true, reason: incident.reason };
  }

  if (incident.alreadyTriaged) {
    return { success: true, skipped: true, reason: "already_triaged" };
  }

  const triage = await runSreIncidentTriage({
    organizationId: incident.organizationId,
    projectId: incident.projectId,
    userId: null,
    incidentId: incident.incidentId,
  });

  if (!triage.success) {
    return {
      success: false,
      error: triage.error,
      incidentId: incident.incidentId,
      investigationRunId: triage.investigationRunId,
    };
  }

  await db
    .update(sreAlertEvents)
    .set({ triageInvestigationRunId: triage.investigationRunId })
    .where(
      and(
        eq(sreAlertEvents.id, incident.alertEventId),
        eq(sreAlertEvents.organizationId, incident.organizationId),
        eq(sreAlertEvents.projectId, incident.projectId),
      ),
    );

  return {
    success: true,
    skipped: false,
    incidentId: incident.incidentId,
    alertEventId: incident.alertEventId,
    investigationRunId: triage.investigationRunId,
  };
}
