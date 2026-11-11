import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { deletionJobs, jobs, monitors } from "@/db/schema";
import type { DeletionScope } from "@/db/schema";

/** Table-backed state for background purges. BullMQ (see queue.ts) only triggers; every decision is made here. */

export type DeletionRow = typeof deletionJobs.$inferSelect;
type Executor = Pick<typeof db, "insert" | "select" | "update">;

export const MAX_ATTEMPTS = Number(process.env.DELETION_MAX_ATTEMPTS || 8);
/** A running purge that has not beaten its heart this long is considered crashed and may be taken over. */
export const STALE_HEARTBEAT_SECONDS = 120;
/** Small global cap on concurrent purges across all pods, and one per organization. */
export const GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.DELETION_PURGE_CONCURRENCY || 2));

export const BLOCKED_RETRY_MS = 30_000;
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
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

export type ClaimResult = { claimed: DeletionRow } | { skip: "gone" | "busy" } | { blocked: true };

/**
 * Take the purge for this process. A short transaction under a global advisory lock enforces the concurrency
 * limits without holding anything while the purge itself runs.
 */
export async function claimDeletion(id: string): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('supercheck:deletion-claim'))`);
    const [row] = await tx.select().from(deletionJobs).where(eq(deletionJobs.id, id)).for("update");
    if (!row || row.state === "completed" || row.state === "failed") return { skip: "gone" } as const;
    const fresh = sql`${deletionJobs.heartbeatAt} > now() - make_interval(secs => ${STALE_HEARTBEAT_SECONDS})`;
    if (row.state === "running" && row.heartbeatAt && row.heartbeatAt.getTime() > Date.now() - STALE_HEARTBEAT_SECONDS * 1000) return { skip: "busy" } as const;
    if (row.nextAttemptAt.getTime() > Date.now() && row.state === "queued") return { skip: "busy" } as const;
    const running = await tx.select({ organizationId: deletionJobs.organizationId }).from(deletionJobs)
      .where(and(eq(deletionJobs.state, "running"), fresh, sql`${deletionJobs.id} <> ${id}`));
    if (running.length >= GLOBAL_CONCURRENCY || (row.organizationId && running.some((other) => other.organizationId === row.organizationId))) {
      // Push the row out so duplicate triggers see "busy" and stop, and the sweep does not re-select it every tick.
      await tx.update(deletionJobs).set({ state: "queued", nextAttemptAt: new Date(Date.now() + BLOCKED_RETRY_MS) }).where(eq(deletionJobs.id, id));
      return { blocked: true } as const;
    }
    const [claimed] = await tx.update(deletionJobs).set({
      state: "running", heartbeatAt: new Date(), startedAt: row.startedAt ?? new Date(),
    }).where(eq(deletionJobs.id, id)).returning();
    return { claimed };
  });
}

export async function heartbeat(id: string, patch: { phase?: string; cursor?: Record<string, unknown> } = {}): Promise<void> {
  await db.update(deletionJobs).set({ heartbeatAt: new Date(), ...patch }).where(eq(deletionJobs.id, id));
}

export async function completeDeletion(id: string): Promise<void> {
  await db.update(deletionJobs).set({ state: "completed", completedAt: new Date(), heartbeatAt: null, lastError: null }).where(eq(deletionJobs.id, id));
}

/** Back off and retry; give up (visible to super admins) after MAX_ATTEMPTS. Returns the delay before the next try, or null when failed. */
export async function failDeletion(row: DeletionRow, error: unknown): Promise<number | null> {
  const attempts = row.attempts + 1;
  const message = truncate(error instanceof Error ? error.message : String(error));
  if (attempts >= MAX_ATTEMPTS) {
    await db.update(deletionJobs).set({ state: "failed", attempts, lastError: message, heartbeatAt: null }).where(eq(deletionJobs.id, row.id));
    return null;
  }
  const delay = backoffMs(attempts);
  await db.update(deletionJobs).set({
    state: "queued", attempts, lastError: message, heartbeatAt: null, nextAttemptAt: new Date(Date.now() + delay),
  }).where(eq(deletionJobs.id, row.id));
  return delay;
}

/** Give a purge back without counting an attempt (waiting for runs to drain, or the concurrency cap). */
export async function releaseDeletion(id: string, delayMs: number): Promise<void> {
  await db.update(deletionJobs).set({ state: "queued", heartbeatAt: null, nextAttemptAt: new Date(Date.now() + delayMs) }).where(eq(deletionJobs.id, id));
}

/** Super admin: put a failed purge back in the queue with a fresh attempt budget. */
export async function retryFailedDeletion(id: string): Promise<boolean> {
  const updated = await db.update(deletionJobs).set({ state: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(and(eq(deletionJobs.id, id), eq(deletionJobs.state, "failed"))).returning({ id: deletionJobs.id });
  return updated.length > 0;
}

/** Everything the sweep must (re)trigger. All lookups hit partial indexes over unfinished rows only. */
export async function findDueDeletions(limit = 50): Promise<string[]> {
  const rows = await db.select({ id: deletionJobs.id }).from(deletionJobs).where(or(
    and(eq(deletionJobs.state, "queued"), lte(deletionJobs.nextAttemptAt, new Date())),
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
