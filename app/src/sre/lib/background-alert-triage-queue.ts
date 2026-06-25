import { Queue } from "bullmq";
import { z } from "zod";

import { getRedisConnection, queueLogger } from "@/lib/queue";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";

export const SRE_ALERT_TRIAGE_QUEUE_NAME = "sre-alert-triage";

const enqueueSchema = z.object({
  alertHistoryId: z.string().uuid(),
});

export type SreAlertTriageQueueJob = z.infer<typeof enqueueSchema>;

let queue: Queue<SreAlertTriageQueueJob> | null = null;

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

  const triageQueue = await getSreAlertTriageQueue();
  return triageQueue.add("triage-alert-history", parsed.data, {
    jobId: `sre-alert-triage:${parsed.data.alertHistoryId}`,
  });
}
