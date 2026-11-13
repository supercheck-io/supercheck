import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { readOrgPendingOn } from "@/lib/deletion/org-state";
import { monitors } from "@/db/schema";
import { removeScheduledMonitor, scheduleMonitor } from "@/lib/monitor-scheduler";
import type { MonitorJobData } from "@/lib/queue";
import { RedisUnavailableError, withRedisDeadline } from "@/lib/security/redis-deadline";

// The row lock is held by the worker-visible FOR UPDATE; the worker gives up after 5s. After it is taken, the scheduler
// calls share one 2.5s budget, and each DB statement (the update, then the commit) is capped at 2s by the SET LOCAL
// timeouts below, so the hold stays under 5s. The caps are per statement, not one shared budget.
const RECONCILE_BUDGET_MS = 2500;
const RECONCILE_DB_TIMEOUT = sql.raw("'2s'");
// Bounds one scheduler call by what is left of the shared budget; the scheduler has no Redis handle here, so readiness is
// left to the call itself. On timeout the signal aborts, so the abandoned call stops before it mutates the queue.
async function withDeadline<T>(deadline: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RedisUnavailableError("Reconcile budget exhausted");
  const abort = new AbortController();
  try {
    return await withRedisDeadline({}, () => call(abort.signal), remaining);
  } catch (error) {
    abort.abort();
    throw error;
  }
}

/**
 * Makes the monitor's repeatable job match its committed row: none while paused or disabled, one while active.
 * A timed-out call is aborted: the scheduler checks the signal before each queue mutation, so an abandoned call cannot
 * delete or re-add a schedule a later reconcile owns. Only a command already in flight may still land; the throw rolls
 * back and keeps scheduledJobId, and the retry re-runs the idempotent calls (schedule replaces any existing repeatable;
 * remove also searches by monitor id when scheduledJobId is null), so the next reconcile repairs it.
 * All calls share one budget started when the row lock is taken, so the paused path's two calls cannot add up past it.
 */
async function reconcileOnce(id: string, projectId: string, state: { active: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    // A slow DB must not hold the row lock past the worker's wait: a timeout rolls back and the route answers 503.
    await tx.execute(sql`SET LOCAL lock_timeout = ${RECONCILE_DB_TIMEOUT}`);
    await tx.execute(sql`SET LOCAL statement_timeout = ${RECONCILE_DB_TIMEOUT}`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`monitor-status:${id}`}))`);
    const [row] = await tx
      .select()
      .from(monitors)
      .where(and(eq(monitors.id, id), eq(monitors.projectId, projectId)))
      .for("update");
    if (!row) return;
    const deadline = Date.now() + RECONCILE_BUDGET_MS;
    // A pending organization's monitors are stopped; the cancel path restores them through this same reconcile.
    // Read on this transaction: a second pool connection while holding one can deadlock a saturated pool.
    const pendingOrganization = row.organizationId ? !!(await readOrgPendingOn(tx, row.organizationId, "share")) : false;
    if (row.status === "paused" || !row.enabled || row.deletingAt || pendingOrganization || row.frequencyMinutes <= 0) {
      // A scheduler failure throws (rolling back, so scheduledJobId stays and a retry converges); an absent job is fine.
      const removed = row.scheduledJobId ? await withDeadline(deadline, (signal) => removeScheduledMonitor(row.scheduledJobId!, signal)) : false;
      if (!removed) await withDeadline(deadline, (signal) => removeScheduledMonitor(id, signal));
      await tx.update(monitors).set({ scheduledJobId: null }).where(eq(monitors.id, id));
      return;
    }
    state.active = true;
    const schedulerId = await withDeadline(deadline, (signal) => scheduleMonitor({
      monitorId: id,
      frequencyMinutes: row.frequencyMinutes,
      jobData: {
        monitorId: id,
        projectId,
        type: row.type as MonitorJobData["type"],
        target: row.target,
        config: row.config as Record<string, unknown>,
        frequencyMinutes: row.frequencyMinutes,
      },
      retryLimit: 3,
    }, signal));
    await tx.update(monitors).set({ scheduledJobId: schedulerId }).where(eq(monitors.id, id));
  });
}

/**
 * Reconcile, and on failure mark an active monitor as unscheduled (scheduledJobId null, best effort; the failed
 * transaction rolled back). A retry of the same request then sees the schedule out of sync and repairs it, even
 * though nothing else about the monitor changed.
 */
export async function reconcileMonitorSchedule(id: string, projectId: string): Promise<void> {
  const state = { active: false };
  try {
    await reconcileOnce(id, projectId, state);
  } catch (error) {
    // A paused or disabled monitor keeps its job id, so the removal is retried; only a failed (re)schedule leaves it unscheduled.
    if (!state.active) throw error;
    try {
      // Short lock wait so a held row lock cannot stall the error response.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await tx
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(and(eq(monitors.id, id), eq(monitors.enabled, true), ne(monitors.status, "paused")));
      });
    } catch {
      // Best effort: the original failure is what the caller needs.
    }
    throw error;
  }
}
