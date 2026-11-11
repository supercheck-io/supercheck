import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue";
import { GLOBAL_CONCURRENCY, findDueDeletions, enqueueOrphanedDeletions, pruneCompletedDeletions } from "./jobs";
import { runDeletion } from "./runner";
import { continueQuiescing, retryPendingBillingCancels } from "./organization";
import { sendDueReminders } from "./notices";

export const DELETION_QUEUE = "deletion-purge";

let queue: Queue | null = null;
let worker: Worker | null = null;

async function getQueue(): Promise<Queue> {
  queue ??= new Queue(DELETION_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 1 },
  });
  return queue;
}

/** A trigger never waits longer than the sweep interval: the sweep re-triggers due rows, and a far-future delayed job would make BullMQ drop every later trigger that reuses its id. */
const MAX_TRIGGER_DELAY_MS = 15 * 60_000;

/**
 * Wake a purge. Duplicate triggers are harmless: the claim in the database admits one runner.
 * `replace` first removes a waiting trigger so an early purge is not swallowed by its deduplication.
 */
export async function triggerDeletion(id: string, delayMs = 0, options: { replace?: boolean } = {}): Promise<void> {
  try {
    const target = await getQueue();
    const jobId = `purge-${id}`;
    if (options.replace) await (await target.getJob(jobId))?.remove().catch(() => undefined);
    // A deterministic id keeps one pending trigger per purge however many callers wake it.
    await target.add("purge", { id }, { delay: Math.min(delayMs, MAX_TRIGGER_DELAY_MS), jobId });
  } catch (error) {
    // The table is the source of truth: the sweep re-triggers anything this misses.
    console.error("[DELETION] Could not queue purge trigger; the sweep will pick it up:", error);
  }
}

/** Start the purge consumer once per process. Concurrency is capped here and, across pods, in the claim. */
export async function initializeDeletionWorker(): Promise<void> {
  if (worker) return;
  worker = new Worker(DELETION_QUEUE, async (job) => {
    const outcome = await runDeletion(job.data.id as string);
    if (outcome.retryInMs !== undefined) await triggerDeletion(job.data.id as string, outcome.retryInMs);
  }, { connection: (await getRedisConnection()).duplicate(), concurrency: GLOBAL_CONCURRENCY, lockDuration: 5 * 60_000 });
  worker.on("error", (error) => console.error("[DELETION] worker error:", error));
}

/** Periodic safety net (data-lifecycle tick): stuck, due and orphaned purges are triggered again. */
export async function sweepDeletions(): Promise<{ triggered: number; orphaned: number; pruned: number; quiesced: number; billing: number; reminders: number }> {
  const pruned = await pruneCompletedDeletions();
  const orphaned = await enqueueOrphanedDeletions();
  const due = await findDueDeletions();
  await Promise.all(due.map((id) => triggerDeletion(id)));
  // Pending organizations: finish stopping activity, retry a billing cancellation that failed at request time, send due reminders.
  // Each is independent and idempotent; one failing never blocks the purge triggers above.
  const settle = async <T>(work: () => Promise<T>, fallback: T) => work().catch((error) => { console.error("[DELETION] sweep step failed:", error); return fallback; });
  const quiesced = await settle(() => continueQuiescing(), 0);
  const billing = await settle(() => retryPendingBillingCancels(), 0);
  const reminders = await settle(() => sendDueReminders(), 0);
  return { triggered: due.length, orphaned, pruned, quiesced, billing, reminders };
}
