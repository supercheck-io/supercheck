import { createHash } from "crypto";
import { Queue } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { alertHistory, jobs, monitors, sreAlertEvents, sreIncidentAlerts, sreIncidents } from "@/db/schema";
import { getRedisConnection, queueLogger } from "@/lib/queue";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import { db } from "@/utils/db";

export const SRE_ALERT_TRIAGE_QUEUE_NAME = "sre-alert-triage";

const enqueueSchema = z.object({
  alertHistoryId: z.string().uuid(),
});

export type SreAlertTriageQueueJob = z.infer<typeof enqueueSchema>;

let queue: Queue<SreAlertTriageQueueJob> | null = null;

type SreAlertTriageEnqueueSkipReason =
  | "alert_not_found"
  | "non_sent_alert"
  | "resolved_alert"
  | "unsupported_source"
  | "already_triaged";

type SreAlertTriageEnqueuePrecheck =
  | { shouldEnqueue: true }
  | { shouldEnqueue: false; reason: SreAlertTriageEnqueueSkipReason };

function deriveAlertStatus(type: string) {
  const normalizedType = type.toLowerCase();
  return normalizedType.includes("recovery") || normalizedType.includes("success") ? "resolved" : "firing";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function shouldEnqueueAlertTriage(alertHistoryId: string): Promise<SreAlertTriageEnqueuePrecheck> {
  const [alert] = await db
    .select({
      id: alertHistory.id,
      status: alertHistory.status,
      type: alertHistory.type,
      monitorId: alertHistory.monitorId,
      jobId: alertHistory.jobId,
      deliveryMetadata: alertHistory.deliveryMetadata,
      monitorOrganizationId: monitors.organizationId,
      monitorProjectId: monitors.projectId,
      jobOrganizationId: jobs.organizationId,
      jobProjectId: jobs.projectId,
    })
    .from(alertHistory)
    .leftJoin(monitors, eq(alertHistory.monitorId, monitors.id))
    .leftJoin(jobs, eq(alertHistory.jobId, jobs.id))
    .where(eq(alertHistory.id, alertHistoryId))
    .limit(1);

  if (!alert) {
    return { shouldEnqueue: false, reason: "alert_not_found" };
  }

  if (alert.status !== "sent") {
    return { shouldEnqueue: false, reason: "non_sent_alert" };
  }

  if (deriveAlertStatus(alert.type) !== "firing") {
    return { shouldEnqueue: false, reason: "resolved_alert" };
  }

  const organizationId = alert.monitorOrganizationId ?? alert.jobOrganizationId;
  const projectId = alert.monitorProjectId ?? alert.jobProjectId;
  const sourceType = alert.monitorId ? "monitor" : alert.jobId ? "job" : null;
  const sourceId = alert.monitorId ?? alert.jobId;

  if (!organizationId || !projectId || !sourceType || !sourceId) {
    return { shouldEnqueue: false, reason: "unsupported_source" };
  }

  const deliveryDedupKey =
    typeof alert.deliveryMetadata?.correlation?.dedupKey === "string" &&
    alert.deliveryMetadata.correlation.dedupKey.trim().length > 0
      ? alert.deliveryMetadata.correlation.dedupKey.trim()
      : undefined;
  const dedupKey = deliveryDedupKey ?? [projectId, sourceType, sourceId, alert.type].join(":");
  const fingerprintHash = sha256(`${organizationId}:${dedupKey}`);

  const [existingTriage] = await db
    .select({
      alertTriageRunId: sreAlertEvents.triageInvestigationRunId,
      incidentTriageRunId: sreIncidents.triageInvestigationRunId,
    })
    .from(sreAlertEvents)
    .leftJoin(sreIncidentAlerts, eq(sreIncidentAlerts.alertEventId, sreAlertEvents.id))
    .leftJoin(sreIncidents, eq(sreIncidentAlerts.incidentId, sreIncidents.id))
    .where(
      and(
        eq(sreAlertEvents.organizationId, organizationId),
        eq(sreAlertEvents.projectId, projectId),
        eq(sreAlertEvents.fingerprintHash, fingerprintHash)
      )
    )
    .orderBy(desc(sreIncidents.createdAt))
    .limit(1);

  if (existingTriage?.alertTriageRunId || existingTriage?.incidentTriageRunId) {
    return { shouldEnqueue: false, reason: "already_triaged" };
  }

  return { shouldEnqueue: true };
}

export async function getSreAlertTriageQueue() {
  if (queue) {
    return queue;
  }

  const connection = await getRedisConnection();
  queue = new Queue<SreAlertTriageQueueJob>(SRE_ALERT_TRIAGE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 1000 },
    },
  });

  queue.on("error", (error) => queueLogger.error({ err: error }, "SRE alert triage queue error"));
  return queue;
}

export async function enqueueSreAlertTriageJob(input: SreAlertTriageQueueJob) {
  if (!isSreBackgroundAlertTriageEnabled()) {
    return null;
  }

  const parsed = enqueueSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  try {
    const precheck = await shouldEnqueueAlertTriage(parsed.data.alertHistoryId);
    if (!precheck.shouldEnqueue) {
      queueLogger.info(
        {
          event: "sre_alert_triage_enqueue_skipped",
          alertHistoryId: parsed.data.alertHistoryId,
          reason: precheck.reason,
        },
        "SRE alert triage enqueue skipped"
      );
      return null;
    }
  } catch (error) {
    queueLogger.error(
      {
        event: "sre_alert_triage_enqueue_precheck_failed",
        err: error,
        alertHistoryId: parsed.data.alertHistoryId,
      },
      "SRE alert triage enqueue dedup check failed; enqueueing for processor-level DB dedup"
    );
  }

  const triageQueue = await getSreAlertTriageQueue();
  return triageQueue.add("triage-alert-history", parsed.data, {
    jobId: `sre-alert-triage:${parsed.data.alertHistoryId}`,
  });
}
