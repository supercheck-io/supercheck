import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue";
import { GLOBAL_CONCURRENCY, findDueDeletions, enqueueOrphanedDeletions, pruneCompletedDeletions } from "./jobs";
import { runDeletion } from "./runner";

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

/** Wake a purge. Duplicate triggers are harmless: the claim in the database admits one runner. */
export async function triggerDeletion(id: string, delayMs = 0): Promise<void> {
  try {
    // A deterministic id keeps one pending trigger per purge however many callers wake it.
    await (await getQueue()).add("purge", { id }, { delay: delayMs, jobId: `purge-${id}` });
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
export async function sweepDeletions(): Promise<{ triggered: number; orphaned: number; pruned: number }> {
  const pruned = await pruneCompletedDeletions();
  const orphaned = await enqueueOrphanedDeletions();
  const due = await findDueDeletions();
  await Promise.all(due.map((id) => triggerDeletion(id)));
  return { triggered: due.length, orphaned, pruned };
}
