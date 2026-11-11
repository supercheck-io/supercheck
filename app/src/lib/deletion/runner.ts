import { BLOCKED_RETRY_MS, LostClaimError, MAX_ATTEMPTS, claimDeletion, completeDeletion, failDeletion, heartbeat, releaseDeletion, type DeletionRow } from "./jobs";
import { purgeJobStep, purgeMonitorStep, type StepContext, type StepResult } from "./purge";
import { purgeOrganizationStep, purgeProjectStep } from "./purge-tenant";

/** One invocation works for at most this long, then hands the rest to the next trigger so a worker slot is never pinned. */
const SLICE_MS = 4 * 60_000;
/** Pause between batches so a big purge never saturates the database. */
const BATCH_PAUSE_MS = Number(process.env.DELETION_BATCH_PAUSE_MS ?? 100);

const handlers: Record<string, (row: DeletionRow, ctx: StepContext) => Promise<StepResult>> = {
  job: purgeJobStep,
  monitor: purgeMonitorStep,
  project: purgeProjectStep,
  organization: purgeOrganizationStep,
};

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
      const cursor = result.progress ?? row.cursor;
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
    const delay = await failDeletion(row, error);
    return delay === null ? {} : { retryInMs: delay };
  } finally {
    clearInterval(timer);
  }
}
