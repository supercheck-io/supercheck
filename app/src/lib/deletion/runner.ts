import { BLOCKED_RETRY_MS, claimDeletion, completeDeletion, failDeletion, heartbeat, releaseDeletion, type DeletionRow } from "./jobs";
import { purgeJobStep, purgeMonitorStep, type StepResult } from "./purge";

/** One invocation works for at most this long, then hands the rest to the next trigger so a worker slot is never pinned. */
const SLICE_MS = 4 * 60_000;
/** Pause between batches so a big purge never saturates the database. */
const BATCH_PAUSE_MS = Number(process.env.DELETION_BATCH_PAUSE_MS ?? 100);

const handlers: Record<string, (row: DeletionRow) => Promise<StepResult>> = {
  job: purgeJobStep,
  monitor: purgeMonitorStep,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the caller should do next: nothing, or trigger again after `retryInMs`. */
export type RunOutcome = { retryInMs?: number };

export async function runDeletion(id: string): Promise<RunOutcome> {
  const claim = await claimDeletion(id);
  if ("skip" in claim) return {};
  if ("blocked" in claim) return { retryInMs: BLOCKED_RETRY_MS };
  let row = claim.claimed;
  const handler = handlers[row.scope];
  if (!handler) {
    await failDeletion({ ...row, attempts: Number.MAX_SAFE_INTEGER - 1 }, new Error(`No purge handler for scope ${row.scope}`));
    return {};
  }
  const deadline = Date.now() + SLICE_MS;
  try {
    for (;;) {
      const result = await handler(row);
      if (result.done) {
        await completeDeletion(row.id);
        return {};
      }
      const cursor = result.progress ?? row.cursor;
      await heartbeat(row.id, { phase: result.phase, cursor });
      row = { ...row, phase: result.phase, cursor };
      if (result.delayMs) {
        await releaseDeletion(row.id, result.delayMs);
        return { retryInMs: result.delayMs };
      }
      if (Date.now() > deadline) {
        await releaseDeletion(row.id, 1000);
        return { retryInMs: 1000 };
      }
      if (BATCH_PAUSE_MS > 0) await sleep(BATCH_PAUSE_MS);
    }
  } catch (error) {
    console.error(`[DELETION] ${row.scope} ${row.targetId} failed:`, error);
    const delay = await failDeletion(row, error);
    return delay === null ? {} : { retryInMs: delay };
  }
}
