import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, jobTests, monitorResults, monitors, reports, runs } from "@/db/schema";
import { createS3CleanupService, type ReportDeletionInput } from "@/lib/s3-cleanup";
import { deleteScheduledJob } from "@/lib/job-scheduler";
import { removeScheduledMonitor } from "@/lib/monitor-scheduler";
import { setCancellationSignal, RUN_CANCELLATION_MARKER } from "@/lib/cancellation-service";
import { removeK6RunLinks, removeK6RunLinksForJob, removeServiceResourceLinks, removeTrialSuspensions } from "@/lib/resource-deletion/linked-records";
import { DELETION_TX_LIMITS, DELETION_TX_STATEMENT_LIMIT } from "@/lib/resource-deletion/chunks";
import type { DeletionRow } from "./jobs";
import { PURGE_BATCH } from "./config";

export { PURGE_BATCH };

/** After this long a running job run that ignored its cancellation is purged anyway. */
export const DRAIN_MAX_MS = 30 * 60_000;

/** Handed to a step by the runner: `beat` proves the claim is still ours (throws if lost) and keeps the heart beating. */
export type StepContext = { beat: () => Promise<void> };

/** One unit of work. `phase` is the resume pointer persisted by the runner; every step is idempotent. */
export type StepResult =
  | { done: true }
  | { done: false; phase: string; progress?: Record<string, unknown>; delayMs?: number };

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const limits = async (tx: Tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = ${DELETION_TX_LIMITS}`);
  await tx.execute(sql`SET LOCAL statement_timeout = ${DELETION_TX_STATEMENT_LIMIT}`);
};
export const reportColumns = { id: reports.id, entityId: reports.entityId, reportPath: reports.reportPath, s3Url: reports.s3Url };
export const asInput = (r: { entityId: string; reportPath: string | null; s3Url: string | null }, entityType: ReportDeletionInput["entityType"]): ReportDeletionInput =>
  ({ reportPath: r.reportPath || undefined, s3Url: r.s3Url || undefined, entityId: r.entityId, entityType });

/** Storage first, so a failure leaves the rows that point at it for the retry. Never called inside a transaction. */
export async function deleteStorage(ctx: StepContext, inputs: ReportDeletionInput[] | ((s3: ReturnType<typeof createS3CleanupService>) => ReportDeletionInput[]), what: string) {
  await ctx.beat();
  const s3 = createS3CleanupService();
  try { // a client per batch, released afterwards so a long purge does not accumulate sockets
    const list = typeof inputs === "function" ? inputs(s3) : inputs;
    if (list.length === 0) return;
    const result = await s3.deleteReports(list);
    if (!result.success) throw new Error(`Could not delete ${what} storage; will retry`);
    await ctx.beat();
  } finally {
    s3.destroy();
  }
}

// Tables whose rows cascade from the target and can be large. Names are constants (never input) and each has an index on the column.
const MONITOR_CHILD_TABLES = ["monitor_aggregates", "monitor_cycles", "alert_history", "alerts", "monitor_aggregate_dedup_audit", "monitor_group_evaluations"] as const;
const JOB_CHILD_TABLES = ["alert_history"] as const;

/** Delete up to one batch of a child table's rows by the target's id; returns how many went. */
async function deleteChildBatch(ctx: StepContext, table: string, column: "monitor_id" | "job_id", id: string): Promise<number> {
  await ctx.beat();
  return db.transaction(async (tx) => {
    await limits(tx);
    const result = await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ctid IN (SELECT ctid FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id} LIMIT ${PURGE_BATCH})`);
    return result.count ?? 0;
  });
}

/**
 * Delete report rows only while they still point where they did when their storage was cleaned: a live execution may
 * have repointed a row (the latest-report alias of a saved test) to a newer report in the meantime, and that one must stay.
 */
const deleteReportRows = (tx: Tx, rows: Array<{ id: string; reportPath: string }>) =>
  rows.length === 0 ? Promise.resolve() : tx.delete(reports).where(
    sql`(${reports.id}, ${reports.reportPath}) IN (${sql.join(rows.map((r) => sql`(${r.id}::uuid, ${r.reportPath})`), sql`, `)})`,
  );

const dbNowMs = async () => Number((await db.execute(sql`SELECT (extract(epoch from now()) * 1000)::float8 AS now_ms`))[0].now_ms);

const progress = (row: DeletionRow, key: string, add: number) => ({ ...row.cursor, [key]: Number(row.cursor?.[key] ?? 0) + add });

export async function purgeMonitorStep(row: DeletionRow, ctx: StepContext): Promise<StepResult> {
  const monitorId = row.targetId;
  const phase = row.phase ?? "unschedule";
  if (phase === "unschedule") {
    await removeScheduledMonitor(monitorId); // throws on a scheduler failure so the purge retries
    return { done: false, phase: "results" };
  }
  if (phase === "results") {
    // Deleted rows leave the set, so no cursor is needed. `= ANY(ARRAY[id])` plus an ORDER BY on the index columns makes the
    // planner walk the (monitor_id, checked_at) index; a plain `monitor_id = $1 ORDER BY checked_at` picked the global
    // checked_at index and filtered every other tenant's rows (EXPLAIN in the PR).
    const batch = await db.select({ id: monitorResults.id, testExecutionId: monitorResults.testExecutionId, url: monitorResults.testReportS3Url })
      .from(monitorResults).where(sql`${monitorResults.monitorId} = ANY(ARRAY[${monitorId}]::uuid[])`)
      .orderBy(asc(monitorResults.monitorId), asc(monitorResults.checkedAt)).limit(PURGE_BATCH);
    if (batch.length === 0) return { done: false, phase: "children" };
    // Report rows by the unique (entity_type, entity_id) key; the unindexed s3_url only for legacy results with a URL and no match.
    const executionIds = batch.flatMap((r) => (r.testExecutionId ? [r.testExecutionId] : []));
    const byExecution = executionIds.length
      ? await db.select(reportColumns).from(reports).where(and(eq(reports.entityType, "monitor"), inArray(reports.entityId, executionIds)))
      : [];
    const matched = new Set(byExecution.map((r) => r.entityId));
    const legacyUrls = [...new Set(batch.flatMap((r) => (r.url && !(r.testExecutionId && matched.has(r.testExecutionId)) ? [r.url] : [])))];
    const legacy = legacyUrls.length
      ? await db.select(reportColumns).from(reports).where(and(eq(reports.entityType, "monitor"), inArray(reports.s3Url, legacyUrls)))
      : [];
    const reportRows = [...new Map([...byExecution, ...legacy].map((r) => [r.id, r])).values()];
    await deleteStorage(ctx, [
      ...batch.filter((r) => r.url).map((r) => ({ reportPath: r.testExecutionId || undefined, s3Url: r.url || undefined, entityId: r.id, entityType: "monitor" as const })),
      ...reportRows.map((r) => asInput(r, "monitor")),
    ], "monitor");
    await ctx.beat(); // still our claim? never delete rows on a lost one
    await db.transaction(async (tx) => {
      await limits(tx);
      await deleteReportRows(tx, reportRows);
      await tx.delete(monitorResults).where(and(eq(monitorResults.monitorId, monitorId), inArray(monitorResults.id, batch.map((r) => r.id))));
    });
    return { done: false, phase: "results", progress: progress(row, "results", batch.length) };
  }
  if (phase === "children") {
    // Cycles, aggregates and alert history cascade from the monitor row; delete them in batches first so the final delete is small.
    let deleted = 0;
    for (const table of MONITOR_CHILD_TABLES) {
      const n = await deleteChildBatch(ctx, table, "monitor_id", monitorId);
      deleted += n;
      if (n === PURGE_BATCH) return { done: false, phase: "children", progress: progress(row, "children", deleted) };
    }
    return { done: false, phase: "final", ...(deleted ? { progress: progress(row, "children", deleted) } : {}) };
  }
  // final: the parent row lock stops new results (their foreign key needs a share lock on it), then verify and delete.
  await ctx.beat();
  const finished = await db.transaction(async (tx) => {
    await limits(tx);
    const [locked] = await tx.select({ id: monitors.id }).from(monitors).where(eq(monitors.id, monitorId)).for("update");
    if (!locked) return true;
    const [straggler] = await tx.select({ id: monitorResults.id }).from(monitorResults).where(eq(monitorResults.monitorId, monitorId)).limit(1);
    if (straggler) return false; // a check finished after the flag was set; purge it too
    await removeServiceResourceLinks(tx, "monitor", [monitorId]);
    await removeTrialSuspensions(tx, "monitor", [monitorId]);
    await tx.delete(monitors).where(eq(monitors.id, monitorId));
    return true;
  });
  return finished ? { done: true } : { done: false, phase: "results" };
}

/**
 * One batch of runs by job or by project: storage first (report rows, run artifacts), then the rows, in one short
 * transaction. Returns how many runs went. Both lookups are indexed: (entity_type, entity_id) for the run's own reports,
 * and the partial report_path index for the latest-report aliases of saved tests that point into a run directory.
 */
export async function purgeRunBatch(ctx: StepContext, column: "jobId" | "projectId", id: string): Promise<number> {
  const col = column === "jobId" ? runs.jobId : runs.projectId;
  const batch = await db.select({ id: runs.id, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata })
    .from(runs).where(sql`${col} = ANY(ARRAY[${id}]::uuid[])`)
    .orderBy(asc(col), sql`${runs.createdAt} desc nulls first`).limit(PURGE_BATCH); // walks the (id, created_at) index; see the monitor batch note
  if (batch.length === 0) return 0;
  const ids = batch.map((r) => r.id);
  const own = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports)
    .where(and(inArray(reports.entityType, ["job", "k6_job", "k6_test"]), inArray(reports.entityId, ids)));
  const aliases = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports)
    .where(and(eq(reports.entityType, "test"), inArray(reports.reportPath, ids.map((runId) => `${runId}/report`))));
  const reportRows = [...new Map([...own, ...aliases].map((r) => [r.id, r])).values()];
  await deleteStorage(ctx, (s3) => [...reportRows.map((r) => asInput(r, r.entityType)), ...batch.flatMap((r) => s3.getRunArtifactInputs(r))], column === "jobId" ? "job run" : "project run");
  await ctx.beat();
  await db.transaction(async (tx) => {
    await limits(tx);
    await deleteReportRows(tx, reportRows);
    await removeK6RunLinks(tx, ids);
    await tx.delete(runs).where(and(eq(col, id), inArray(runs.id, ids)));
  });
  return batch.length;
}

export async function purgeJobStep(row: DeletionRow, ctx: StepContext): Promise<StepResult> {
  const jobId = row.targetId;
  const phase = row.phase ?? "unschedule";
  if (phase === "unschedule") {
    await deleteScheduledJob(jobId, { throwOnError: true });
    return { done: false, phase: "drain", progress: { ...row.cursor, drainStartedAtMs: await dbNowMs() } };
  }
  if (phase === "drain") {
    // Page by id so more than one batch of active runs is all reached; the cursor wraps after the last page.
    const after = typeof row.cursor?.drainAfter === "string" ? row.cursor.drainAfter : null;
    const active = await db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.jobId, jobId), inArray(runs.status, ["queued", "running"]), after ? gt(runs.id, after) : undefined))
      .orderBy(asc(runs.id)).limit(PURGE_BATCH);
    if (active.length === 0) {
      if (after) return { done: false, phase: "drain", progress: { ...row.cursor, drainAfter: null } }; // wrapped: re-check from the start
      return { done: false, phase: "runs" };
    }
    // Measured from when this drain began (not from the delete request), so a purge that starts late still gives runs time to stop.
    const nowMs = await dbNowMs();
    const startedMs = Number(row.cursor?.drainStartedAtMs);
    if (!Number.isFinite(startedMs)) return { done: false, phase: "drain", progress: { ...row.cursor, drainStartedAtMs: nowMs } }; // a row from before the marker existed
    if (nowMs - startedMs > DRAIN_MAX_MS) return { done: false, phase: "runs" };
    await cancelActiveRuns(jobId, active.map((r) => r.id));
    const more = active.length === PURGE_BATCH;
    return { done: false, phase: "drain", progress: { ...row.cursor, drainAfter: more ? active[active.length - 1].id : null }, ...(more ? {} : { delayMs: 15_000 }) };
  }
  if (phase === "runs") {
    const purged = await purgeRunBatch(ctx, "jobId", jobId);
    if (purged === 0) return { done: false, phase: "children" };
    return { done: false, phase: "runs", progress: progress(row, "runs", purged) };
  }
  if (phase === "children") {
    let deleted = 0;
    for (const table of JOB_CHILD_TABLES) {
      const n = await deleteChildBatch(ctx, table, "job_id", jobId);
      deleted += n;
      if (n === PURGE_BATCH) return { done: false, phase: "children", progress: progress(row, "children", deleted) };
    }
    return { done: false, phase: "job_reports", ...(deleted ? { progress: progress(row, "children", deleted) } : {}) };
  }
  if (phase === "job_reports") {
    const own = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports).where(and(eq(reports.entityId, jobId), eq(reports.entityType, "job")));
    await deleteStorage(ctx, own.map((r) => asInput(r, r.entityType)), "job");
    await ctx.beat();
    if (own.length) await db.transaction(async (tx) => { await limits(tx); await deleteReportRows(tx, own); });
    return { done: false, phase: "final" };
  }
  await ctx.beat();
  const finished = await db.transaction(async (tx) => {
    await limits(tx);
    const [locked] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!locked) return true;
    const [straggler] = await tx.select({ id: runs.id }).from(runs).where(eq(runs.jobId, jobId)).limit(1);
    if (straggler) return false; // a run was created after the flag was set (a late schedule); purge it too
    await removeServiceResourceLinks(tx, "job", [jobId]);
    await removeK6RunLinksForJob(tx, jobId);
    await tx.delete(jobTests).where(eq(jobTests.jobId, jobId));
    await tx.delete(jobs).where(eq(jobs.id, jobId));
    return true;
  });
  return finished ? { done: true } : { done: false, phase: "runs" };
}

/** Same mechanism as the run cancel route: marker first (a worker that claims the run is refused), then the Redis signal. */
export async function cancelActiveRuns(jobId: string, runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  await db.update(runs).set({ errorDetails: RUN_CANCELLATION_MARKER })
    .where(and(eq(runs.jobId, jobId), inArray(runs.id, runIds), inArray(runs.status, ["queued", "running"])));
  await Promise.allSettled(runIds.map((id) => setCancellationSignal(id)));
}
