import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import type { ExecutionUsageTransaction } from './execution-usage-receipts';

type Database = PostgresJsDatabase<typeof schema>;
type CallbackScope = {
  db: Database;
  runId: string;
  owner: string;
  closed: boolean;
  pending: Set<Promise<unknown>>;
};
const callbacks = new AsyncLocalStorage<CallbackScope>();

export class RunCallbackBusyError extends Error {}
export class RunCallbackFencedError extends Error {}

/** Lock order: organization (when billing), run, callback, report. */
export async function canPersistRunCallback(
  tx: ExecutionUsageTransaction,
): Promise<boolean> {
  const scope = callbacks.getStore();
  if (!scope) return true;
  if (scope.closed) return false;
  const [run] = await tx
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(eq(schema.runs.id, scope.runId))
    .for('update');
  if (!run) return false;
  const [owner] = await tx
    .select()
    .from(schema.runCallbacks)
    .where(eq(schema.runCallbacks.runId, scope.runId))
    .for('update');
  return (
    !!owner &&
    owner.owner === scope.owner &&
    !owner.revokedAt &&
    !owner.finishedAt
  );
}

/** Ownership lasts through uploads and final persistence, independently of BullMQ/pods. */
export async function withRunCallback<T>(
  db: Database,
  runId: string | null | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  if (!runId) return callback();
  const owner = randomUUID();
  const acquired = await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: schema.runs.status })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .for('update');
    if (!run || !['queued', 'running'].includes(run.status)) return false;
    const [existing] = await tx
      .select()
      .from(schema.runCallbacks)
      .where(eq(schema.runCallbacks.runId, runId))
      .for('update');
    if (existing?.revokedAt)
      throw new RunCallbackFencedError('Run callback fenced');
    if (existing && !existing.finishedAt) {
      // Only recovery may revoke a stale owner, after checking the execution pod.
      throw new RunCallbackBusyError('Run callback is still active');
    }
    await tx
      .insert(schema.runCallbacks)
      .values({ runId, owner })
      .onConflictDoUpdate({
        target: schema.runCallbacks.runId,
        set: { owner, heartbeatAt: new Date(), finishedAt: null },
      });
    return true;
  });
  // Terminal/replay handling stays in the processor, without creating new ownership.
  if (!acquired) return callback();
  const scope: CallbackScope = {
    db,
    runId,
    owner,
    closed: false,
    pending: new Set(),
  };
  let heartbeat: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = db
      .update(schema.runCallbacks)
      .set({ heartbeatAt: new Date() })
      .where(
        and(
          eq(schema.runCallbacks.runId, runId),
          eq(schema.runCallbacks.owner, owner),
          sql`${schema.runCallbacks.revokedAt} IS NULL`,
        ),
      )
      .returning({ id: schema.runCallbacks.runId })
      .then((rows) => {
        if (!rows.length) scope.closed = true;
      })
      // Every write rechecks ownership; a transient heartbeat error is not lease loss.
      .catch(() => {})
      .finally(() => {
        heartbeat = undefined;
      });
  }, 10_000);
  timer.unref();
  return callbacks.run(scope, async () => {
    try {
      return await callback();
    } finally {
      scope.closed = true;
      await Promise.allSettled([...scope.pending]);
      clearInterval(timer);
      await heartbeat;
      await db
        .update(schema.runCallbacks)
        .set({ finishedAt: new Date() })
        .where(
          and(
            eq(schema.runCallbacks.runId, runId),
            eq(schema.runCallbacks.owner, owner),
          ),
        );
    }
  });
}

/** Register before sending, retain forever: even an ACK can hide an uncertain SDK retry. */
export function writeRunArtifact<T>(
  bucket: string,
  key: string,
  write: () => Promise<T>,
): Promise<T> {
  const scope = callbacks.getStore();
  if (!scope) return write();
  if (scope.closed || !key.startsWith(`${scope.runId}/`)) {
    return Promise.reject(
      new RunCallbackFencedError(
        'Artifact is outside its active run namespace',
      ),
    );
  }
  const pending = (async () => {
    await scope.db.transaction(async (tx) => {
      if (!(await canPersistRunCallback(tx)))
        throw new RunCallbackFencedError('Run callback fenced');
      const [registered] = await tx
        .update(schema.runCallbacks)
        .set({ bucket })
        .where(
          and(
            eq(schema.runCallbacks.runId, scope.runId),
            sql`(${schema.runCallbacks.bucket} IS NULL OR ${schema.runCallbacks.bucket} = ${bucket})`,
          ),
        )
        .returning({ id: schema.runCallbacks.runId });
      if (!registered)
        throw new RunCallbackFencedError('Run artifact bucket changed');
    });
    return write();
  })();
  scope.pending.add(pending);
  void pending.finally(() => scope.pending.delete(pending)).catch(() => {});
  return pending;
}

/** A stale callback is fenced, never assumed drained; its prefix survives deletion. */
export async function lockRecoverableRunCallbacks(
  tx: ExecutionUsageTransaction,
  runIds: string[],
): Promise<string[]> {
  await tx
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(inArray(schema.runs.id, runIds))
    .orderBy(schema.runs.id)
    .for('update');
  const owners = await tx
    .select()
    .from(schema.runCallbacks)
    .where(inArray(schema.runCallbacks.runId, runIds))
    .orderBy(schema.runCallbacks.runId)
    .for('update');
  const healthy = new Set(
    owners
      .filter(
        (owner) =>
          !owner.revokedAt &&
          !owner.finishedAt &&
          owner.heartbeatAt.getTime() > Date.now() - 120_000,
      )
      .map((owner) => owner.runId),
  );
  const recoverable = runIds.filter((id) => !healthy.has(id));
  if (recoverable.length)
    await tx
      .update(schema.runCallbacks)
      .set({ revokedAt: new Date() })
      .where(inArray(schema.runCallbacks.runId, recoverable));
  return recoverable;
}

/** Parent FK locks precede the run lock, matching project/job deletion. */
export async function canPersistK6Result(
  tx: ExecutionUsageTransaction,
  organizationId: string,
  projectId: string,
  jobId?: string | null,
): Promise<boolean> {
  if (!callbacks.getStore()) return true;
  const [organization] = await tx
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .for('key share');
  if (!organization) return false;
  const [project] = await tx
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .for('key share');
  if (!project) return false;
  if (jobId) {
    const [job] = await tx
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .for('key share');
    if (!job) return false;
  }
  return canPersistRunCallback(tx);
}
