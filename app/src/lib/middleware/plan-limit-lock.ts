import { sql } from "drizzle-orm";
import { db } from "@/utils/db";

export type PlanLimitTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type PlanLimitResource =
  | "monitors"
  | "projects"
  | "members"
  | "status_pages"
  | "subscribers";

/** Max time a request waits for the per-organization lock before giving up. */
export const PLAN_LIMIT_LOCK_TIMEOUT_MS = 5000;

/** Thrown when the plan-limit lock could not be acquired within the timeout. */
export class PlanLimitBusyError extends Error {
  constructor() {
    super("Another request is updating this plan limit. Please retry.");
    this.name = "PlanLimitBusyError";
  }
}

// Postgres SQLSTATE lock_not_available, raised when lock_timeout expires.
const LOCK_NOT_AVAILABLE = "55P03";

function isLockTimeout(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e
      ? (e as { code?: unknown }).code
      : undefined;
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  return code(error) === LOCK_NOT_AVAILABLE || code(cause) === LOCK_NOT_AVAILABLE;
}

/**
 * Serialize "count -> check plan limit -> insert" for one organization/resource.
 *
 * Plan limits are enforced by reading a count and then inserting, which two
 * concurrent requests can both pass. Holding a transaction-scoped advisory lock
 * across the whole sequence makes the second request see the first one's row.
 * The lock is released automatically on commit/rollback, so a crashed request
 * cannot leave it held. `fn` must run its count and insert on the `tx` it is
 * given (never the global `db`): the lock already holds one pool connection, so
 * needing a second can deadlock a saturated pool. Do slow work (scheduling,
 * email) after this returns.
 *
 * Waiters give up after PLAN_LIMIT_LOCK_TIMEOUT_MS with PlanLimitBusyError, so a
 * burst of same-org requests cannot pin the whole connection pool.
 */
export async function withPlanLimitLock<T>(
  organizationId: string,
  resource: PlanLimitResource,
  fn: (tx: PlanLimitTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    try {
      const previous = await tx.execute(
        sql`select current_setting('lock_timeout') as value`
      );
      const previousTimeout =
        (previous as unknown as Array<{ value?: string }> | undefined)?.[0]
          ?.value ?? "0";
      await tx.execute(
        sql`select set_config('lock_timeout', ${`${PLAN_LIMIT_LOCK_TIMEOUT_MS}ms`}, true)`
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`plan-limit:${resource}:${organizationId}`}))`
      );
      // The short timeout is only for acquiring the advisory lock; restore the
      // session's own setting for everything the callback runs.
      await tx.execute(
        sql`select set_config('lock_timeout', ${previousTimeout}, true)`
      );
    } catch (error) {
      // Only a failure to take the lock means "busy"; callback errors pass through.
      if (isLockTimeout(error)) throw new PlanLimitBusyError();
      throw error;
    }
    return fn(tx);
  });
}

type LimitCheck = { allowed: boolean; limit?: number };

export type InsertWithinLimitResult<TRow, TCheck extends LimitCheck> =
  | { ok: true; row: TRow }
  | { ok: false; busy?: undefined; check: TCheck }
  | { ok: false; busy: true; check?: undefined };

/**
 * Insert a row only if the organization is under its plan limit, race-free.
 *
 * `check` is a plan-enforcement function (e.g. `checkMonitorLimit`). It is called
 * with count 0 first to resolve the plan *outside* the lock (it needs its own
 * pool connection). Only the count and insert run inside the lock, on `tx`.
 * When the limit is hit, `check` is called again with the real count, after the
 * lock is released, so callers get the exact denial object they got before.
 */
export async function insertWithinPlanLimit<TRow, TCheck extends LimitCheck>(opts: {
  organizationId: string;
  resource: PlanLimitResource;
  /** Overrides the lock scope (default: organizationId), e.g. per status page. */
  lockKey?: string;
  check: (organizationId: string, currentCount: number) => Promise<TCheck>;
  countRows: (tx: PlanLimitTransaction) => Promise<number>;
  insert: (executor: PlanLimitTransaction | typeof db) => Promise<TRow>;
}): Promise<InsertWithinLimitResult<TRow, TCheck>> {
  const { organizationId, resource, check, countRows, insert } = opts;
  const lockKey = opts.lockKey ?? organizationId;

  const plan = await check(organizationId, 0);
  if (!plan.allowed) return { ok: false, check: plan };
  if (plan.limit === undefined) {
    // No limit applies (self-hosted): nothing to serialize.
    return { ok: true, row: await insert(db) };
  }
  const limit = plan.limit;

  let outcome;
  try {
    outcome = await withPlanLimitLock(lockKey, resource, async (tx) => {
      const count = await countRows(tx);
      if (count >= limit) return { atLimit: true as const, count };
      return { atLimit: false as const, row: await insert(tx) };
    });
  } catch (error) {
    if (error instanceof PlanLimitBusyError) return { ok: false, busy: true };
    throw error;
  }

  if (!outcome.atLimit) return { ok: true, row: outcome.row };
  return { ok: false, check: await check(organizationId, outcome.count) };
}
