import { DelayedError, Worker } from "bullmq";

import { getRedisConnection, queueLogger } from "@/lib/queue";
import { processSreBackgroundAlertTriageJob } from "@/sre/lib/background-alert-triage";
import { SRE_ALERT_TRIAGE_QUEUE_NAME, type SreAlertTriageQueueJob } from "@/sre/lib/background-alert-triage-queue";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";

/** How long, and how often, a triage start blocked by the org's run cap is retried. */
export const ORG_LIMIT_DEFER_WINDOW_MS = 30 * 60_000;
export const ORG_LIMIT_DEFER_DELAY_MS = 60_000;

let worker: Worker<SreAlertTriageQueueJob> | null = null;
let initPromise: Promise<boolean> | null = null;

export async function initializeSreAlertTriageProcessor() {
  if (!isSreBackgroundAlertTriageEnabled()) {
    return false;
  }

  if (worker) {
    return true;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const connection = await getRedisConnection();
    worker = new Worker<SreAlertTriageQueueJob>(
      SRE_ALERT_TRIAGE_QUEUE_NAME,
      async (job, token) => {
        const result = await processSreBackgroundAlertTriageJob(job.data);
        // The org's run cap is full: wait without using an attempt, up to a bounded window, so the
        // incident still gets its triage once the org's other runs finish.
        if (
          result.success &&
          result.skipped &&
          result.reason === "org_concurrency_limit" &&
          token &&
          Date.now() - job.timestamp < ORG_LIMIT_DEFER_WINDOW_MS
        ) {
          await job.moveToDelayed(Date.now() + ORG_LIMIT_DEFER_DELAY_MS, token);
          throw new DelayedError();
        }
        // Throw on real failures so BullMQ applies its attempts/backoff instead of marking the job completed.
        if (!result.success) {
          throw new Error(result.error);
        }
        return result;
      },
      {
        connection: connection.duplicate(),
        concurrency: 1,
        lockDuration: 90_000,
        autorun: false,
      }
    );

    worker.on("completed", (job) => queueLogger.info({ jobId: job.id }, "SRE alert triage job completed"));
    worker.on("failed", (job, error) => queueLogger.error({ jobId: job?.id, err: error }, "SRE alert triage job failed"));
    worker.on("error", (error) => queueLogger.error({ err: error }, "SRE alert triage worker error"));

    worker.run().catch((error) => {
      queueLogger.error({ err: error }, "SRE alert triage worker run loop failed");
    });

    return true;
  })();

  return initPromise;
}

export async function shutdownSreAlertTriageProcessor() {
  const pending = initPromise;
  initPromise = null;
  // Wait for an in-flight init so its Worker is not left running after shutdown.
  await pending?.catch(() => undefined);
  const w = worker;
  worker = null;
  await w?.close();
}
