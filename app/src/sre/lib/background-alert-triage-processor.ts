import { Worker } from "bullmq";

import { getRedisConnection, queueLogger } from "@/lib/queue";
import { processSreBackgroundAlertTriageJob } from "@/sre/lib/background-alert-triage";
import { SRE_ALERT_TRIAGE_QUEUE_NAME, type SreAlertTriageQueueJob } from "@/sre/lib/background-alert-triage-queue";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";

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
      async (job) => processSreBackgroundAlertTriageJob(job.data),
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

    await worker.run();
    return true;
  })();

  return initPromise;
}

export async function shutdownSreAlertTriageProcessor() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  initPromise = null;
}
