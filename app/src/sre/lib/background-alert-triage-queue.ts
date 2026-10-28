import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { alertHistory, jobs, monitors } from "@/db/schema";
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
  | "unsupported_source";

type SreAlertTriageEnqueuePrecheck =
  | { shouldEnqueue: true }
  | { shouldEnqueue: false; reason: SreAlertTriageEnqueueSkipReason };

// Mirrors the worker enqueue rule: delivered or failed alerts, firing or recovery,
// from a monitor or job. Incident dedup, recovery and reopen happen in the processor.
async function shouldEnqueueAlertTriage(alertHistoryId: string): Promise<SreAlertTriageEnqueuePrecheck> {
  const [alert] = await db
    .select({
      status: alertHistory.status,
      monitorId: alertHistory.monitorId,
      jobId: alertHistory.jobId,
      monitorOrganizationId: monitors.organizationId,
      jobOrganizationId: jobs.organizationId,
    })
    .from(alertHistory)
    .leftJoin(monitors, eq(alertHistory.monitorId, monitors.id))
    .leftJoin(jobs, eq(alertHistory.jobId, jobs.id))
    .where(eq(alertHistory.id, alertHistoryId))
    .limit(1);

  if (!alert) {
    return { shouldEnqueue: false, reason: "alert_not_found" };
  }

  if (alert.status !== "sent" && alert.status !== "failed") {
    return { shouldEnqueue: false, reason: "non_sent_alert" };
  }

  if (!(alert.monitorId ?? alert.jobId) || !(alert.monitorOrganizationId ?? alert.jobOrganizationId)) {
    return { shouldEnqueue: false, reason: "unsupported_source" };
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
      // BullMQ custom job IDs must not contain a colon.
      jobId: `sre-alert-triage-${parsed.data.alertHistoryId}`,
  });
}
