import { validateAIConfiguration } from "@/lib/ai/ai-provider";
import { createHash } from "crypto";
import { and, desc, eq, gt, gte, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  alertHistory,
  jobs,
  monitors,
  runs,
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
  isSreAutomaticTriageEnabled,
  isSreBackgroundAlertTriageEnabled,
} from "@/sre/lib/feature-gates";
import {
  announceSystemTransition,
  applySourceRecovery,
  findOpenIncidentForSource,
  noteFailureReturned,
  recordRepeatAlert,
  getDefaultAssigneeId,
  reopenRecentlyAutoResolved,
} from "@/lib/sre/incident-lifecycle";
import { incidentsEnabled } from "@/lib/incident-settings";
import { isAttemptedAlertStatus } from "@/lib/alert-escalation";
import { alertIncidentTitle } from "@/lib/sre/alert-labels";
import { linkStatusPageIncidentsToSreIncident } from "@/lib/status-page-reconciliation";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { watchIncident } from "@/lib/sre/incident-watchers";
import { maybeAutoInvestigateOnOpen } from "@/sre/lib/auto-investigate";
import { completeSreIncidentTriage, startSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-background-alert-triage" }) as {
  warn: (data: unknown, message?: string) => void;
  error: (data: unknown, message?: string) => void;
};

// Keep in sync with SreAlertTriageQueueJob in worker/src/monitor/services/sre-alert-triage-queue.service.ts.
const backgroundTriageJobSchema = z.union([
  z.object({ alertHistoryId: z.string().uuid() }),
  z.object({
    // A failure with no alert row: the monitor has no channel, or alerts are off.
    sourceFailure: z.object({
      sourceType: z.literal("monitor"),
      sourceId: z.string().uuid(),
      type: z.literal("monitor_failure"),
      message: z.string().max(2000),
      firedAt: z.string().datetime(),
    }),
  }),
  z.object({
    sourceRecovery: z.object({
      sourceType: z.enum(["monitor", "job"]),
      sourceId: z.string().uuid(),
      recoveredAt: z.string().datetime(),
    }),
  }),
]);

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
        | "triage_in_progress"
        | "triage_billing"
        | "org_concurrency_limit"
        | "unsupported_source"
        | "incident_disabled"
        | "recovery_handled"
        | "recovered_before_triage"
        | "ai_disabled"
        | "ai_not_configured"
        | "auto_investigation";
    }
  | {
      success: false;
      error: string;
      incidentId?: string;
      investigationRunId?: string;
    };


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

const RECOVERABLE_FAILURE_TYPES = new Set(["monitor_failure", "job_failed", "job_timeout"]);

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


type SourceRecoveryInput = {
  organizationId: string;
  projectId: string;
  sourceType: SreAlertSourceType;
  sourceId: string;
  targetName: string;
  autoResolve: boolean;
  recoveredAt: Date;
  /** Dedupes the notification for this recovery. */
  discriminator: string;
};

export async function handleSourceRecovery(input: SourceRecoveryInput) {
  const { discriminator, ...source } = input;
  const recovery = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${source.organizationId}))`,
    );
    return applySourceRecovery(tx, source);
  });
  for (const { id } of recovery.resolved) {
    await announceSystemTransition(source.organizationId, source.projectId, id, "resolved", {
      discriminator,
    });
  }
  for (const { id, assigneeUserId } of recovery.recovered) {
    await announceSystemTransition(source.organizationId, source.projectId, id, "recovered", {
      assigneeUserId,
      discriminator,
    });
  }
  return recovery;
}

/** A recovery the worker sends on every up-transition, delivered or not. */
async function processSourceRecovery(recovery: {
  sourceType: SreAlertSourceType;
  sourceId: string;
  recoveredAt: string;
}) {
  // Org, project and settings come from the source row, never from the payload.
  const table = recovery.sourceType === "monitor" ? monitors : jobs;
  const [source] = await db
    .select({
      organizationId: table.organizationId,
      projectId: table.projectId,
      name: table.name,
      alertConfig: table.alertConfig,
    })
    .from(table)
    .where(eq(table.id, recovery.sourceId))
    .limit(1);
  if (!source?.organizationId || !source.projectId) {
    return { skipped: true as const, reason: "unsupported_source" as const };
  }
  await handleSourceRecovery({
    organizationId: source.organizationId,
    projectId: source.projectId,
    sourceType: recovery.sourceType,
    sourceId: recovery.sourceId,
    targetName: source.name,
    autoResolve: source.alertConfig?.autoResolveIncident !== false,
    recoveredAt: new Date(recovery.recoveredAt),
    discriminator: `${recovery.sourceType}:${recovery.sourceId}:${recovery.recoveredAt}`,
  });
  return { skipped: true as const, reason: "recovery_handled" as const };
}

/**
 * When the source is already back up after this failure fired, the time it recovered.
 * Covers a failure processed after its recovery (a retry, or a queue backlog).
 * Used only when recoveryThreshold is 1: a monitor flips to up and a job run passes on the first
 * success, so a longer threshold is left to the worker's recovery signal.
 */
export async function sourceRecoveredSince(
  sourceType: SreAlertSourceType,
  sourceId: string,
  firedAt: Date,
): Promise<Date | null> {
  // Compared in SQL: these are timestamps without time zone.
  if (sourceType === "monitor") {
    const [row] = await db
      .select({ at: monitors.lastStatusChangeAt })
      .from(monitors)
      .where(and(eq(monitors.id, sourceId), eq(monitors.status, "up"), gt(monitors.lastStatusChangeAt, firedAt)))
      .limit(1);
    return row?.at ?? null;
  }
  const [latest] = await db
    .select({ status: runs.status, at: runs.completedAt })
    .from(runs)
    .where(and(eq(runs.jobId, sourceId), gt(runs.completedAt, firedAt)))
    .orderBy(desc(runs.completedAt))
    .limit(1);
  return latest?.status === "passed" ? latest.at : null;
}

type SourceFailureInput = { sourceId: string; type: string; message: string; firedAt: string };

/** Shapes a source failure like the alert_history row the incident logic reads (id is null: there is none). */
async function syntheticFailureAlert(failure: SourceFailureInput) {
  const [monitor] = await db
    .select({
      name: monitors.name,
      organizationId: monitors.organizationId,
      projectId: monitors.projectId,
      alertConfig: monitors.alertConfig,
      status: monitors.status,
      enabled: monitors.enabled,
    })
    .from(monitors)
    .where(eq(monitors.id, failure.sourceId))
    .limit(1);
  // A failure queued before the monitor was paused or disabled must not open or update an incident.
  if (monitor && (monitor.status === "paused" || !monitor.enabled)) return undefined;
  // Only a monitor that opted in to incidents without alerts, or one that alerts with incidents on, opens one here.
  if (!monitor || !incidentsEnabled(monitor.alertConfig)) return undefined;
  return {
    id: null as string | null,
    targetType: "monitor" as string | null,
    target: monitor.name,
    monitorId: failure.sourceId as string | null,
    jobId: null as string | null,
    type: failure.type,
    message: failure.message,
    status: "sent" as string,
    provider: null as string | null,
    sentAt: new Date(failure.firedAt) as Date | null,
    monitorName: monitor.name as string | null,
    monitorOrganizationId: monitor.organizationId as string | null,
    monitorProjectId: monitor.projectId as string | null,
    monitorAlertConfig: monitor.alertConfig,
    jobName: null as string | null,
    jobAlertConfig: null,
    jobOrganizationId: null as string | null,
    jobProjectId: null as string | null,
  };
}

async function createOrGetIncidentForAlertHistory(alertHistoryId: string, failure?: SourceFailureInput) {
  const [loaded] = failure
    ? [undefined]
    : await db
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
      monitorName: monitors.name,
      monitorOrganizationId: monitors.organizationId,
      monitorProjectId: monitors.projectId,
      monitorAlertConfig: monitors.alertConfig,
      jobName: jobs.name,
      jobAlertConfig: jobs.alertConfig,
      jobOrganizationId: jobs.organizationId,
      jobProjectId: jobs.projectId,
    })
    .from(alertHistory)
    .leftJoin(monitors, eq(alertHistory.monitorId, monitors.id))
    .leftJoin(jobs, eq(alertHistory.jobId, jobs.id))
    .where(eq(alertHistory.id, alertHistoryId))
    .limit(1);

  const alert = failure ? await syntheticFailureAlert(failure) : loaded;
  if (!alert) {
    return { skipped: true as const, reason: "alert_not_found" as const };
  }

  // Failed deliveries still open an incident; only undelivered (pending) rows wait.
  if (!isAttemptedAlertStatus(alert.status)) {
    return { skipped: true as const, reason: "non_sent_alert" as const };
  }

  const alertStatus = deriveAlertStatus(alert.type);

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
  const alertConfig = alert.monitorId
    ? alert.monitorAlertConfig
    : alert.jobAlertConfig;
  const firedAt = alert.sentAt ?? new Date();
  const alertKey = alert.id ?? `failure:${sourceId}:${firedAt.toISOString()}`;

  if (alertStatus !== "firing") {
    // Recovery: resolve (or flag) open incidents of the same source, regardless of alert type.
    await handleSourceRecovery({
      organizationId,
      projectId,
      sourceType,
      sourceId,
      targetName,
      autoResolve: alertConfig?.autoResolveIncident !== false,
      recoveredAt: firedAt,
      discriminator: alertKey,
    });
    return { skipped: true as const, reason: "recovery_handled" as const };
  }

  if (alertConfig?.incidentEnabled === false) {
    return { skipped: true as const, reason: "incident_disabled" as const };
  }

  const severity =
    alertConfig?.incidentSeverity &&
    ["sev1", "sev2", "sev3", "sev4"].includes(alertConfig.incidentSeverity)
      ? alertConfig.incidentSeverity
      : deriveSeverity(alert.type, alert.message);
  // One identity per source and alert type. The delivery correlation key is per
  // channel (webhooks use a type-less "monitor:<id>"), so using it made one
  // failure delivered to Slack and a webhook open two incidents.
  const dedupKey = [projectId, sourceType, sourceId, alert.type].join(":");
  const fingerprintHash = sha256(`${organizationId}:${dedupKey}`);
  const title = alertIncidentTitle(targetName, alert.type);

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
      .limit(1)
      // Lock the reused row so a concurrent retention purge cannot delete it before it is linked.
      .for("update");

    // Reused per org+fingerprint: refresh to the latest failure so correlation and evidence are current.
    if (existingAlertEvent) {
      await tx
        .update(sreAlertEvents)
        .set({
          severity,
          status: alertStatus,
          serviceId: mappedService?.id ?? null,
          title,
          description: alert.message,
          firedAt,
          resolvedAt: null,
        })
        .where(
          and(
            eq(sreAlertEvents.id, existingAlertEvent.id),
            lt(sreAlertEvents.firedAt, firedAt),
          ),
        );
    }

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
        status: sreIncidents.status,
        triageInvestigationRunId: sreIncidents.triageInvestigationRunId,
      })
      .from(sreIncidentAlerts)
      .innerJoin(
        sreIncidents,
        eq(sreIncidentAlerts.incidentId, sreIncidents.id),
      )
      .where(
          and(
            eq(sreIncidentAlerts.alertEventId, alertEvent.id),
            // Resolved incidents only stop absorbing the alert when they were resolved
            // before this firing; a queued retry must not open a second incident.
            or(
              ne(sreIncidents.status, "resolved"),
              gte(sreIncidents.resolvedAt, firedAt),
            ),
          ),
        )
      .orderBy(desc(sreIncidents.createdAt))
      .limit(1);

    if (existingIncident) {
      if (existingIncident.status !== "resolved") await recordRepeatAlert(tx, existingIncident.id, firedAt);
      if (existingIncident.status !== "resolved" && RECOVERABLE_FAILURE_TYPES.has(alert.type)) {
        await noteFailureReturned(tx, existingIncident.id, firedAt);
      }
      return {
        skipped: false as const,
        organizationId,
        projectId,
        alertEventId: alertEvent.id,
        incidentId: existingIncident.id,
        alreadyTriaged: Boolean(existingIncident.triageInvestigationRunId),
      };
    }

    // A failure shortly after an automatic recovery is the same incident coming back.
    const reopened = RECOVERABLE_FAILURE_TYPES.has(alert.type)
      ? await reopenRecentlyAutoResolved(tx, {
        organizationId,
        projectId,
        sourceType,
        sourceId,
        firedAt,
      })
      : null;
    if (reopened?.stale) {
      await tx
        .insert(sreIncidentAlerts)
        .values({
          incidentId: reopened.incidentId,
          alertEventId: alertEvent.id,
          role: "related",
          alertTitle: title,
          alertDescription: alert.message,
          alertSeverity: severity,
          alertFiredAt: firedAt,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      await recordRepeatAlert(tx, reopened.incidentId, firedAt);
      return {
        skipped: false as const,
        organizationId,
        projectId,
        alertEventId: alertEvent.id,
        incidentId: reopened.incidentId,
        alreadyTriaged: true,
      };
    }
    if (reopened) {
      await recordRepeatAlert(tx, reopened.incidentId, firedAt);
      return {
        skipped: false as const,
        organizationId,
        projectId,
        alertEventId: alertEvent.id,
        incidentId: reopened.incidentId,
        alreadyTriaged: reopened.alreadyTriaged,
        reopenedAssigneeUserId: reopened.assigneeUserId,
      };
    }

    // A recoverable failure joins the source's open incident even under a different identity.
    if (RECOVERABLE_FAILURE_TYPES.has(alert.type)) {
      const openForSource = await findOpenIncidentForSource(tx, { organizationId, projectId, sourceType, sourceId });
      if (openForSource) {
        await tx
          .insert(sreIncidentAlerts)
          .values({
            incidentId: openForSource.id,
            alertEventId: alertEvent.id,
            role: "related",
            alertTitle: title,
            alertDescription: alert.message,
            alertSeverity: severity,
            alertFiredAt: firedAt,
            createdAt: new Date(),
          })
          .onConflictDoNothing();
        await recordRepeatAlert(tx, openForSource.id, firedAt);
        await noteFailureReturned(tx, openForSource.id, firedAt);
        return {
          skipped: false as const,
          organizationId,
          projectId,
          alertEventId: alertEvent.id,
          incidentId: openForSource.id,
          alreadyTriaged: Boolean(openForSource.triageInvestigationRunId),
        };
      }
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
              alertTitle: title,
              alertDescription: alert.message,
              alertSeverity: severity,
              alertFiredAt: firedAt,
              createdAt: new Date(),
            })
            .onConflictDoNothing();
          await recordRepeatAlert(correlationTx, correlation.candidate.incidentId, firedAt);

          await correlationTx.insert(sreIncidentTimelineEvents).values({
            incidentId: correlation.candidate.incidentId,
            eventType: "state_change",
            eventData: {
              state: "alert_correlated",
              alertEventId: alertEvent.id,
              // Alert events are reused and retitled, so keep the name as it was when linked.
              alertTitle: title.slice(0, 200),
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
        alertCount: 1,
        lastAlertAt: firedAt,
        primaryServiceId: mappedService?.id ?? null,
        assigneeUserId: await getDefaultAssigneeId(tx, {
          organizationId,
          projectId,
          serviceId: mappedService?.id ?? null,
        }),
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: sreIncidents.id, assigneeUserId: sreIncidents.assigneeUserId });

    if (incident.assigneeUserId) await watchIncident(tx, incident.id, incident.assigneeUserId);

    await tx.insert(sreIncidentAlerts).values({
      incidentId: incident.id,
      alertEventId: alertEvent.id,
      role: "trigger",
      alertTitle: title,
      alertDescription: alert.message,
      alertSeverity: severity,
      alertFiredAt: firedAt,
      createdAt: new Date(),
    });

    if (sourceType === "monitor") {
      await linkStatusPageIncidentsToSreIncident(tx, {
        sreIncidentId: incident.id,
        organizationId,
        projectId,
        monitorId: sourceId,
      });
    }

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
      createdAssigneeUserId: incident.assigneeUserId,
    };
  });

  if (!result.skipped && "createdAssigneeUserId" in result) {
    await notifyIncidentEvent({
      organizationId,
      projectId,
      incidentId: result.incidentId,
      event: "created",
      assigneeUserId: result.createdAssigneeUserId,
    });
  }

  if (!result.skipped && "reopenedAssigneeUserId" in result) {
    await announceSystemTransition(organizationId, projectId, result.incidentId, "reopened", {
      assigneeUserId: result.reopenedAssigneeUserId,
      discriminator: alertKey,
    });
  }

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

  // The source already came back: keep the incident as a record, resolve it now and skip AI triage.
  // Only with a one-check recovery threshold: source state alone cannot tell a longer streak apart.
  if (!result.skipped && RECOVERABLE_FAILURE_TYPES.has(alert.type) && (alertConfig?.recoveryThreshold ?? 1) <= 1) {
    const recoveredAt = await sourceRecoveredSince(sourceType, sourceId, firedAt);
    if (recoveredAt) {
      await handleSourceRecovery({
        organizationId,
        projectId,
        sourceType,
        sourceId,
        targetName,
        autoResolve: alertConfig?.autoResolveIncident !== false,
        recoveredAt,
        discriminator: `${alertKey}:late-recovery`,
      });
      return { skipped: true as const, reason: "recovered_before_triage" as const };
    }
  }

  return result;
}

/**
 * The AI step on top of an open incident: the project's auto-investigate policy first, else instance-wide
 * automatic triage. Every gate lives here (policy, feature flag, AI config, billing, org run cap), so the
 * alert job and the recovery sweep's re-triage cannot diverge. Only the start is awaited; the run settles detached.
 */
export async function startAutomaticIncidentTriage(incident: {
  organizationId: string;
  projectId: string;
  incidentId: string;
}): Promise<
  | { skipped: true; reason: Extract<SreBackgroundAlertTriageResult, { skipped: true }>["reason"] }
  | { skipped?: false; success: true; investigationRunId: string }
  | { skipped?: false; success: false; error: string; incidentId: string; investigationRunId?: string }
> {
  // The project's own opt-in (SEV1-2 full investigation, SEV3-4 triage) takes over from the instance-wide triage below.
  const auto = await maybeAutoInvestigateOnOpen({
    organizationId: incident.organizationId,
    projectId: incident.projectId,
    incidentId: incident.incidentId,
    userId: null,
  });
  if (auto.handled) return { skipped: true, reason: "auto_investigation" };
  // Already investigated automatically: a later alert joining this incident must not start another AI run.
  if (auto.reason === "already_investigated") return { skipped: true, reason: "already_triaged" };

  // Incidents open regardless; AI triage is the optional part on top.
  if (!isSreAutomaticTriageEnabled()) {
    return { skipped: true, reason: "ai_disabled" };
  }
  try {
    validateAIConfiguration();
  } catch {
    return { skipped: true, reason: "ai_not_configured" };
  }

  // Only the start (admission, billing and concurrency checks, run row) is awaited: the AI run
  // takes minutes, longer than the job lock. Stale-run recovery fails a run that never settles.
  const triageInput = {
    organizationId: incident.organizationId,
    projectId: incident.projectId,
    userId: null,
    incidentId: incident.incidentId,
    // Detached runs are no longer bounded by the queue concurrency: "auto" applies the per-organization cap.
    origin: "auto" as const,
  };
  const triage = await startSreIncidentTriage(triageInput);

  if (!triage.success && triage.status === 409 && triage.reason === "org_concurrency_limit") {
    // The organization's run cap clears as its other runs finish: the processor delays and retries this job.
    logger.warn({ incidentId: incident.incidentId }, "Background triage deferred: organization run limit");
    return { skipped: true, reason: "org_concurrency_limit" };
  }

  if (!triage.success && triage.status === 409) {
    // Another triage/investigation is already running for this incident; nothing to retry.
    logger.warn({ incidentId: incident.incidentId }, "Background triage skipped: an investigation is already running");
    return { skipped: true, reason: "triage_in_progress" };
  }

  if (!triage.success && triage.status === 402) {
    // Plan or credit limits do not clear on retry.
    logger.warn({ incidentId: incident.incidentId }, "Background triage skipped: billing limit");
    return { skipped: true, reason: "triage_billing" };
  }

  if (!triage.success) {
    return {
      success: false,
      error: triage.error,
      incidentId: incident.incidentId,
      investigationRunId: triage.investigationRunId,
    };
  }


  void completeSreIncidentTriage(triage, triageInput).catch((error) =>
    logger.error(
      { errorName: error instanceof Error ? error.name : typeof error, incidentId: incident.incidentId, investigationRunId: triage.investigationRunId },
      "Background triage failed after it started",
    ),
  );
  return { success: true, investigationRunId: triage.investigationRunId };
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

  if ("sourceRecovery" in parsed.data) {
    const recovery = await processSourceRecovery(parsed.data.sourceRecovery);
    return { success: true, skipped: true, reason: recovery.reason };
  }

  const incident =
    "sourceFailure" in parsed.data
      ? await createOrGetIncidentForAlertHistory("", parsed.data.sourceFailure)
      : await createOrGetIncidentForAlertHistory(parsed.data.alertHistoryId);
  if (incident.skipped) {
    return { success: true, skipped: true, reason: incident.reason };
  }

  if (incident.alreadyTriaged) {
    return { success: true, skipped: true, reason: "already_triaged" };
  }

  const started = await startAutomaticIncidentTriage(incident);
  if (started.skipped) return { success: true, skipped: true, reason: started.reason };
  if (!started.success) return started;
  const triage = started;

  try {
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
  } catch (error) {
    // The run is already in flight; a retry would only hit the 409 skip, so log instead of failing the job.
    logger.error(
      { errorName: error instanceof Error ? error.name : typeof error, alertEventId: incident.alertEventId, investigationRunId: triage.investigationRunId },
      "Could not link background triage run to the alert event",
    );
  }

  return {
    success: true,
    skipped: false,
    incidentId: incident.incidentId,
    alertEventId: incident.alertEventId,
    investigationRunId: triage.investigationRunId,
  };
}
