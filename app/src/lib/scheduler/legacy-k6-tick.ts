import type { Job, Queue } from "bullmq";

/**
 * Adds the cron repeatable for a scheduled job. The deterministic jobId makes
 * re-adding the same schedule idempotent and removal by key easy.
 */
export function addJobRepeatable(
  queue: Queue,
  schedulerJobName: string,
  data: Record<string, unknown>,
  pattern: string,
  tz: string
) {
  return queue.add(schedulerJobName, data, {
    repeat: { pattern, tz },
    removeOnComplete: true,
    removeOnFail: 100,
    jobId: schedulerJobName,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });
}

/**
 * Processor for the legacy k6-job-scheduler queue. An old-version replica can
 * re-add a k6 repeatable there after the queue merge; the first tick converges it
 * so the job never fires from both queues.
 *
 * - job-scheduler already schedules this job: drop the legacy repeatable and skip the tick.
 *   If the legacy schedule differs it is the newer write (only old code adds here), so it
 *   replaces the job-scheduler copy.
 * - otherwise: move the schedule to job-scheduler (add first, so it is never dropped),
 *   remove the legacy entry and process this tick.
 * Idempotent: the add is keyed by job id and removals of a missing key are no-ops.
 * A job-scheduler lookup is a getRepeatableJobs scan (legacy-created entries are not
 * job schedulers); it runs only for legacy ticks, which stop once converged.
 *
 * shortcut: legacy k6-job-scheduler consumer kept for one release; remove in release N+1
 */
export async function processLegacyK6Tick<R>(
  job: Job,
  { jobSchedulerQueue, k6JobSchedulerQueue }: { jobSchedulerQueue: Queue; k6JobSchedulerQueue: Queue },
  process: (job: Job) => Promise<R>
): Promise<R | undefined> {
  // Repeat tick ids are repeat:<repeat key>:<fire time>; anything else is not ours to converge.
  const legacyKey = job.id?.startsWith("repeat:") ? job.id.split(":")[1] : undefined;
  const { pattern, tz } = job.opts?.repeat ?? {};
  if (!legacyKey || !pattern) return process(job);

  const existing = (await jobSchedulerQueue.getRepeatableJobs()).filter((r) => r.name === job.name);
  const same = existing.some((r) => r.pattern === pattern && (r.tz ?? "UTC") === (tz ?? "UTC"));
  if (existing.length === 0 || !same) {
    await Promise.all(existing.map((r) => jobSchedulerQueue.removeRepeatableByKey(r.key)));
    await addJobRepeatable(jobSchedulerQueue, job.name, job.data, pattern, tz ?? "UTC");
  }
  await k6JobSchedulerQueue.removeRepeatableByKey(legacyKey);
  return existing.length === 0 ? process(job) : undefined;
}
