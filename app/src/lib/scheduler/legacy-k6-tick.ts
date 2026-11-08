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
 * so the job never fires from both queues, and no due fire is lost.
 *
 * - Retry of a failed tick: just process it (convergence already happened on attempt 1).
 * - job-scheduler has the same schedule: drop the legacy repeatable. Skip this tick only if
 *   that copy fires at or before this tick's due time (same slot); otherwise process it.
 * - job-scheduler has a different schedule: the database decides the winner (a tick queued
 *   before a reschedule is stale; a job with no cron is orphaned and just drops the legacy
 *   entry). job-scheduler is made to match, and this due tick is processed.
 * - no job-scheduler copy: move the schedule (add first, so it is never dropped), then process.
 * The same-slot skip is only a fast path: once job-scheduler's copy has been picked up, BullMQ has already advanced
 * its `next`, so a later legacy tick for that slot runs. Both copies carry the same tick id (BullMQ derives it from
 * name, jobId, tz and pattern, not the queue), so processScheduledJob's per-tick run guard (keyed on the tick id and
 * attempt; it ships with the execution-capacity hardening change, which must merge first) rejects the second run.
 * Idempotent: adds are keyed by job id and removals of a missing key are no-ops. The
 * job-scheduler lookup is a getRepeatableJobs scan (legacy-created entries are not job
 * schedulers); it runs only for legacy ticks, which stop once converged.
 *
 * shortcut: legacy k6-job-scheduler consumer kept for one release; remove in release N+1
 */
export async function processLegacyK6Tick<R>(
  job: Job,
  { jobSchedulerQueue, k6JobSchedulerQueue }: { jobSchedulerQueue: Queue; k6JobSchedulerQueue: Queue },
  process: (job: Job) => Promise<R>,
  loadCron: (jobId: string) => Promise<string | null>
): Promise<R | undefined> {
  // Repeat tick ids are repeat:<repeat key>:<fire time>; anything else is not ours to converge.
  const idParts = job.id?.startsWith("repeat:") ? job.id.split(":") : undefined;
  const legacyKey = job.repeatJobKey ?? idParts?.[1];
  const { pattern, tz } = job.opts?.repeat ?? {};
  if (!idParts || !legacyKey || !pattern) return process(job);
  if (job.attemptsMade > 0) return process(job);

  const dueAt = Number(idParts[idParts.length - 1]) || job.timestamp + (job.delay ?? 0);
  const existing = (await jobSchedulerQueue.getRepeatableJobs()).filter((r) => r.name === job.name);
  const sameCopy = existing.find((r) => r.pattern === pattern && (r.tz ?? "UTC") === (tz ?? "UTC"));

  let win = { pattern, tz: tz ?? "UTC" };
  if (existing.length > 0 && !sameCopy) {
    const cron = await loadCron(job.data?.jobId);
    if (!cron) {
      await k6JobSchedulerQueue.removeRepeatableByKey(legacyKey);
      return process(job); // deleted or unscheduled: the processor removes the schedule everywhere
    }
    if (cron !== pattern) win = { pattern: cron, tz: "UTC" };
  }
  const keep = sameCopy && win.pattern === pattern;
  if (!keep) {
    await Promise.all(existing.map((r) => jobSchedulerQueue.removeRepeatableByKey(r.key)));
    await addJobRepeatable(jobSchedulerQueue, job.name, job.data, win.pattern, win.tz);
  }
  await k6JobSchedulerQueue.removeRepeatableByKey(legacyKey);
  const duplicate = keep && (sameCopy?.next ?? Infinity) <= dueAt;
  return duplicate ? undefined : process(job);
}
