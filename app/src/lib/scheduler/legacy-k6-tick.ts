import type { Job, Queue, RepeatableJob } from "bullmq";

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
 * re-add a k6 repeatable there after the queue merge; the tick converges it
 * so the job never fires from both queues, and no due fire is lost.
 *
 * - job-scheduler holds exactly this schedule: drop the legacy repeatable. Skip this tick only if
 *   that copy's next fire is this tick's slot (it will fire it); otherwise process it.
 * - anything else (no copy, a different copy, or several): the database cron decides. A job with no
 *   cron is orphaned and just drops the legacy entry. job-scheduler is made to hold one repeatable
 *   with that cron (keeping a matching entry and its timezone), and this due tick is processed.
 * - Order is add, then remove: a failure part way leaves an extra schedule, never none, and a retry
 *   re-runs the (idempotent) convergence. A retry is never skipped as a duplicate.
 * Once job-scheduler's copy has been picked up, BullMQ has already advanced its `next`, so a later legacy
 * tick for that slot runs. Both copies carry the same tick id (BullMQ derives it from name, jobId, tz and
 * pattern, not the queue), so processScheduledJob's per-tick run guard (keyed on the tick id and attempt, under a
 * transaction-scoped advisory lock) rejects the second run.
 * The job-scheduler lookup is a getRepeatableJobs scan (legacy-created entries are not job
 * schedulers); it runs only for legacy ticks, which stop once converged.
 *
 * shortcut: legacy k6-job-scheduler consumer kept for one release; remove in release N+1
 */
export async function processLegacyK6Tick<R>(
  job: Job,
  { jobSchedulerQueue, k6JobSchedulerQueue }: { jobSchedulerQueue: Queue; k6JobSchedulerQueue: Queue },
  process: (job: Job) => Promise<R>,
  loadCron: (jobId: string, scope: { projectId?: string; organizationId?: string }) => Promise<string | null>
): Promise<R | undefined> {
  // Repeat tick ids are repeat:<repeat key>:<fire time>; anything else is not ours to converge.
  const idParts = job.id?.startsWith("repeat:") ? job.id.split(":") : undefined;
  const legacyKey = job.repeatJobKey ?? idParts?.[1];
  const { pattern, tz: legacyTz } = job.opts?.repeat ?? {};
  if (!idParts || !legacyKey || !pattern) return process(job);
  const tz = legacyTz ?? "UTC";
  const { projectId, organizationId } = job.data ?? {};
  // The cron lookup is tenant-scoped; without scope leave the legacy entry for startup migration to converge.
  if (!projectId || !organizationId) return process(job);

  const dueAt = Number(idParts[idParts.length - 1]) || job.timestamp + (job.delay ?? 0);
  const existing = (await jobSchedulerQueue.getRepeatableJobs()).filter((r) => r.name === job.name);
  const matches = (r: RepeatableJob, w: { pattern: string; tz: string }) => r.pattern === w.pattern && (r.tz ?? "UTC") === w.tz;

  let win = { pattern, tz };
  if (!(existing.length === 1 && matches(existing[0], win))) {
    const cron = await loadCron(job.data?.jobId, { projectId, organizationId });
    if (!cron) {
      await k6JobSchedulerQueue.removeRepeatableByKey(legacyKey);
      return process(job); // deleted or unscheduled: the processor removes the schedule everywhere
    }
    if (cron !== pattern) win = { pattern: cron, tz: existing.find((r) => r.pattern === cron)?.tz ?? "UTC" };
  }
  const kept = existing.find((r) => matches(r, win));
  if (!kept) await addJobRepeatable(jobSchedulerQueue, job.name, job.data, win.pattern, win.tz);
  await Promise.all(existing.filter((r) => r !== kept).map((r) => jobSchedulerQueue.removeRepeatableByKey(r.key)));
  await k6JobSchedulerQueue.removeRepeatableByKey(legacyKey);
  const duplicate = job.attemptsMade === 0 && win.pattern === pattern && win.tz === tz && kept?.next === dueAt;
  return duplicate ? undefined : process(job);
}
