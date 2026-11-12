import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { deletionJobs, jobs, monitors } from "@/db/schema";
import type { DeletionScope } from "@/db/schema";
import { GLOBAL_CONCURRENCY, MAX_ATTEMPTS } from "./config";

export { GLOBAL_CONCURRENCY, MAX_ATTEMPTS };

/** Table-backed state for background purges. BullMQ (see queue.ts) only triggers; every decision is made here. */

export type DeletionRow = typeof deletionJobs.$inferSelect;
type Executor = Pick<typeof db, "insert" | "select" | "update">;

/** A running purge that has not beaten its heart this long is considered crashed and may be taken over. */
export const STALE_HEARTBEAT_SECONDS = 300;

export const BLOCKED_RETRY_MS = 30_000;
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
/** Finished rows older than this are pruned by the sweep. */
export const COMPLETED_RETENTION_DAYS = 30;
/** Every timestamp comes from the database clock, so pods with skewed clocks agree. */
const afterMs = (ms: number) => sql`now() + make_interval(secs => ${ms / 1000})`;
const truncate = (message: string) => message.slice(0, 1000);

/** Idempotent: a second request (another pod, a double click) converges on the single live row. */
export async function insertDeletionJob(
  executor: Executor,
  input: { scope: DeletionScope; targetId: string; organizationId?: string | null; requestedByUserId?: string | null },
): Promise<string> {
  const [created] = await executor.insert(deletionJobs).values({
    scope: input.scope,
    targetId: input.targetId,
    organizationId: input.organizationId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
  }).onConflictDoNothing().returning({ id: deletionJobs.id });
  if (created) return created.id;
  const [live] = await executor.select({ id: deletionJobs.id }).from(deletionJobs)
    .where(and(eq(deletionJobs.scope, input.scope), eq(deletionJobs.targetId, input.targetId), sql`${deletionJobs.state} <> 'completed'`)).limit(1);
  if (!live) throw new Error("Deletion job vanished while being requested");
  return live.id;
}

export type ClaimResult = { claimed: DeletionRow } | { skip: "gone" } | { skip: "busy"; retryInMs?: number } | { blocked: true };

/** The runner lost its claim (a stale takeover): it must stop without writing anything more. */
export class LostClaimError extends Error {}

const owned = (row: Pick<DeletionRow, "id" | "ownerToken">) => and(eq(deletionJobs.id, row.id), eq(deletionJobs.state, "running"), eq(deletionJobs.ownerToken, row.ownerToken ?? randomUUID()));

/**
 * Take the purge for this process. A short transaction under a global advisory lock enforces the concurrency
 * limits without holding anything while the purge itself runs. The returned row carries the owner token that
 * every later write must present.
 */
export async function claimDeletion(id: string): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('supercheck:deletion-claim'))`);
    // Time comparisons use the database clock, so pods with skewed clocks agree.
    const [row] = await tx.select({
      row: deletionJobs,
      heartbeatFresh: sql<boolean>`coalesce(${deletionJobs.heartbeatAt} > now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS}), false)`,
      waitMs: sql<number>`greatest(0, extract(epoch from (${deletionJobs.nextAttemptAt} - now())) * 1000)::float8`,
    }).from(deletionJobs).where(eq(deletionJobs.id, id)).for("update");
    if (!row || row.row.state === "completed" || row.row.state === "failed") return { skip: "gone" } as const;
    if (row.row.state === "running" && row.heartbeatFresh) return { skip: "busy" } as const;
    if (row.row.state === "queued" && row.waitMs > 0) return { skip: "busy", retryInMs: Math.ceil(row.waitMs) } as const;
    const running = await tx.select({ organizationId: deletionJobs.organizationId }).from(deletionJobs)
      .where(and(eq(deletionJobs.state, "running"), sql`${deletionJobs.heartbeatAt} > now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})`, sql`${deletionJobs.id} <> ${id}`));
    if (running.length >= GLOBAL_CONCURRENCY || (row.row.organizationId && running.some((other) => other.organizationId === row.row.organizationId))) {
      // Push the row out so duplicate triggers see "busy" and stop, and the sweep does not re-select it every tick.
      await tx.update(deletionJobs).set({ state: "queued", ownerToken: null, heartbeatAt: null, nextAttemptAt: afterMs(BLOCKED_RETRY_MS) }).where(eq(deletionJobs.id, id));
      return { blocked: true } as const;
    }
    const [claimed] = await tx.update(deletionJobs).set({
      state: "running", heartbeatAt: sql`now()`, ownerToken: randomUUID(), startedAt: row.row.startedAt ?? sql`now()`,
    }).where(eq(deletionJobs.id, id)).returning();
    return { claimed };
  });
}

/** Beat the heart. Progress (`progressed`) also resets the attempt budget: it counts consecutive failures, not a whole purge. */
export async function heartbeat(row: DeletionRow, patch: { phase?: string; cursor?: Record<string, unknown>; progressed?: boolean } = {}): Promise<void> {
  const { progressed, ...fields } = patch;
  const updated = await db.update(deletionJobs).set({ heartbeatAt: sql`now()`, ...fields, ...(progressed ? { attempts: 0 } : {}) })
    .where(owned(row)).returning({ id: deletionJobs.id });
  if (updated.length === 0) throw new LostClaimError(`Lost the claim on deletion ${row.id}`);
}

export async function completeDeletion(row: DeletionRow): Promise<void> {
  await db.update(deletionJobs).set({ state: "completed", completedAt: sql`now()`, heartbeatAt: null, ownerToken: null, lastError: null }).where(owned(row));
}

/** Back off and retry; give up (visible to super admins) after MAX_ATTEMPTS. Returns the delay before the next try, or null when failed. */
export async function failDeletion(row: DeletionRow, error: unknown): Promise<number | null> {
  const attempts = row.attempts + 1;
  const message = truncate(error instanceof Error ? error.message : String(error));
  if (attempts >= MAX_ATTEMPTS) {
    const failed = await db.update(deletionJobs).set({ state: "failed", attempts, lastError: message, heartbeatAt: null, ownerToken: null }).where(owned(row)).returning({ id: deletionJobs.id });
    // Stable text: the ops log alert (Loki rule DeletionPurgeFailed) matches it. Ids and counters only, no tenant content.
    if (failed.length) console.error(`[DELETION] Deletion purge failed permanently: id=${row.id} scope=${row.scope} target=${row.targetId} phase=${row.phase ?? "start"} attempts=${attempts} error=${message}`);
    return null;
  }
  const delay = backoffMs(attempts);
  await db.update(deletionJobs).set({
    state: "queued", attempts, lastError: message, heartbeatAt: null, ownerToken: null, nextAttemptAt: afterMs(delay),
  }).where(owned(row));
  return delay;
}

/** Give a purge back without counting an attempt (waiting for runs to drain, or a time slice ending). */
export async function releaseDeletion(row: DeletionRow, delayMs: number): Promise<void> {
  await db.update(deletionJobs).set({ state: "queued", heartbeatAt: null, ownerToken: null, nextAttemptAt: afterMs(delayMs) }).where(owned(row));
}

/** Super admin: put a failed purge back in the queue with a fresh attempt budget. */
export async function retryFailedDeletion(id: string, executor: Pick<typeof db, "update"> = db): Promise<boolean> {
  const updated = await executor.update(deletionJobs).set({ state: "queued", attempts: 0, nextAttemptAt: sql`now()`, lastError: null })
    .where(and(eq(deletionJobs.id, id), eq(deletionJobs.state, "failed"))).returning({ id: deletionJobs.id });
  return updated.length > 0;
}

/** Everything the sweep must (re)trigger. All lookups hit partial indexes over unfinished rows only. */
export async function findDueDeletions(limit = 50): Promise<string[]> {
  const rows = await db.select({ id: deletionJobs.id }).from(deletionJobs).where(or(
    and(eq(deletionJobs.state, "queued"), lte(deletionJobs.nextAttemptAt, sql`now()`)),
    and(eq(deletionJobs.state, "running"), sql`${deletionJobs.heartbeatAt} < now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})`),
  )).orderBy(deletionJobs.nextAttemptAt).limit(limit);
  return rows.map((row) => row.id);
}

/** Targets flagged `deleting` whose deletion row was never written (a crash between the two): create it so they are not stuck hidden forever. */
export async function enqueueOrphanedDeletions(limit = 50): Promise<number> {
  let created = 0;
  for (const [scope, table] of [["job", jobs], ["monitor", monitors]] as const) {
    const orphans = await db.select({ id: table.id, organizationId: table.organizationId }).from(table)
      .where(and(isNotNull(table.deletingAt), sql`NOT EXISTS (SELECT 1 FROM deletion_jobs d WHERE d.scope = ${scope} AND d.target_id = ${table.id} AND d.state <> 'completed')`))
      .limit(limit);
    for (const orphan of orphans) {
      await insertDeletionJob(db, { scope, targetId: orphan.id, organizationId: orphan.organizationId });
      created++;
    }
  }
  return created;
}

/** Keep the table small: completed rows are history nobody needs after a month. */
export async function pruneCompletedDeletions(limit = 500): Promise<number> {
  const old = await db.select({ id: deletionJobs.id }).from(deletionJobs)
    .where(and(eq(deletionJobs.state, "completed"), lt(deletionJobs.completedAt, sql`now() - make_interval(days => ${COMPLETED_RETENTION_DAYS})`))).limit(limit);
  if (old.length === 0) return 0;
  await db.delete(deletionJobs).where(inArray(deletionJobs.id, old.map((row) => row.id)));
  return old.length;
}
