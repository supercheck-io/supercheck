import { BATCH_PAUSE_MS, MAX_ATTEMPTS, MAX_TOTAL_STEPS } from "./config";
import { BLOCKED_RETRY_MS, LostClaimError, claimDeletion, completeDeletion, failDeletion, heartbeat, releaseDeletion, type DeletionRow } from "./jobs";
import { purgeJobStep, purgeMonitorStep, type StepContext, type StepResult } from "./purge";
import { purgeOrganizationStep, purgeProjectStep } from "./purge-tenant";

/** One invocation works for at most this long, then hands the rest to the next trigger so a worker slot is never pinned. */
const SLICE_MS = 4 * 60_000;

const handlers: Record<string, (row: DeletionRow, ctx: StepContext) => Promise<StepResult>> = {
  job: purgeJobStep,
  monitor: purgeMonitorStep,
  project: purgeProjectStep,
  organization: purgeOrganizationStep,
};

class StepCapError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keeps the heart beating while a long step (storage, a big delete) runs, well inside the stale window. */
const HEARTBEAT_EVERY_MS = 30_000;
/** Past the time slice by this much, a step is considered wedged and its claim is left to go stale. */
const WEDGED_AFTER_MS = 60_000;

/** What the caller should do next: nothing, or trigger again after `retryInMs`. */
export type RunOutcome = { retryInMs?: number };

export async function runDeletion(id: string): Promise<RunOutcome> {
  const claim = await claimDeletion(id);
  if ("skip" in claim) return claim.skip === "busy" && claim.retryInMs ? { retryInMs: claim.retryInMs } : {};
  if ("blocked" in claim) return { retryInMs: BLOCKED_RETRY_MS };
  let row = claim.claimed;
  const handler = handlers[row.scope];
  if (!handler) {
    await failDeletion({ ...row, attempts: MAX_ATTEMPTS - 1 }, new Error(`No purge handler for scope ${row.scope}`));
    return {};
  }
  const deadline = Date.now() + SLICE_MS;
  // Beat in the background and from inside the step. A lost claim surfaces at the next beat, which every step calls
  // before it deletes anything, so a pod that was taken over stops instead of racing the new owner.
  let lost: LostClaimError | null = null;
  const beat = async () => {
    if (lost) throw lost;
    try {
      await heartbeat(row);
    } catch (error) {
      if (error instanceof LostClaimError) lost = error;
      throw error;
    }
  };
  // Single flight, and it stops once the slice is well overdue: a step that never settles (a hung Redis call) must go
  // stale so another pod can take over, not keep its claim and a concurrency slot forever.
  let beating: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (Date.now() > deadline + WEDGED_AFTER_MS) { clearInterval(timer); return; }
    if (beating) return;
    beating = beat().catch(() => undefined).finally(() => { beating = null; });
  }, HEARTBEAT_EVERY_MS);
  timer.unref();
  try {
    for (;;) {
      const result = await handler(row, { beat });
      if (lost) throw lost;
      if (result.done) {
        await completeDeletion(row);
        return {};
      }
      // `steps` counts batches that made progress. Progress resets the attempt budget, so this is the absolute stop for a purge that never drains.
      const steps = Number(row.cursor?.steps ?? 0) + (result.progress ? 1 : 0);
      if (result.progress && steps >= MAX_TOTAL_STEPS) throw new StepCapError(`Gave up after ${steps} batches without finishing (phase ${result.phase}); something keeps adding rows or the target never drains`);
      const cursor = { ...(result.progress ?? row.cursor), steps };
      await heartbeat(row, { phase: result.phase, cursor, progressed: !!result.progress });
      row = { ...row, phase: result.phase, cursor, ...(result.progress ? { attempts: 0 } : {}) }; // mirrors the reset in heartbeat()
      if (result.delayMs) {
        await releaseDeletion(row, result.delayMs);
        return { retryInMs: result.delayMs };
      }
      if (Date.now() > deadline) {
        await releaseDeletion(row, 1000);
        return { retryInMs: 1000 };
      }
      if (BATCH_PAUSE_MS > 0) await sleep(BATCH_PAUSE_MS);
    }
  } catch (error) {
    if (error instanceof LostClaimError) return {}; // another pod owns it now; it carries on
    console.error(`[DELETION] ${row.scope} ${row.targetId} failed:`, error);
    // The step cap fails the purge outright; ordinary errors back off and retry.
    const delay = await failDeletion(error instanceof StepCapError ? { ...row, attempts: MAX_ATTEMPTS - 1 } : row, error);
    return delay === null ? {} : { retryInMs: delay };
  } finally {
    clearInterval(timer);
  }
}
