import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobs, jobTests, monitorResults, monitors, reports, runs } from "@/db/schema";
import { createS3CleanupService, type ReportDeletionInput } from "@/lib/s3-cleanup";
import { deleteScheduledJob } from "@/lib/job-scheduler";
import { removeScheduledMonitor } from "@/lib/monitor-scheduler";
import { setCancellationSignal, RUN_CANCELLATION_MARKER } from "@/lib/cancellation-service";
import { removeK6RunLinks, removeK6RunLinksForJob, removeServiceResourceLinks, removeTrialSuspensions } from "@/lib/resource-deletion/linked-records";
import { DELETION_TX_LIMITS, DELETION_TX_STATEMENT_LIMIT } from "@/lib/resource-deletion/chunks";
import type { DeletionRow } from "./jobs";

/** Rows (and S3 prefixes) handled per batch: bounded statements and short row locks. */
export const PURGE_BATCH = Math.min(1000, Math.max(100, Number(process.env.DELETION_BATCH_SIZE || 500)));
/** After this long a running job run that ignored its cancellation is purged anyway. */
export const DRAIN_MAX_MS = 30 * 60_000;

/** One unit of work. `phase` is the resume pointer persisted by the runner; every step is idempotent. */
export type StepResult =
  | { done: true }
  | { done: false; phase: string; progress?: Record<string, unknown>; delayMs?: number };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const limits = async (tx: Tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = ${DELETION_TX_LIMITS}`);
  await tx.execute(sql`SET LOCAL statement_timeout = ${DELETION_TX_STATEMENT_LIMIT}`);
};
const reportColumns = { id: reports.id, entityId: reports.entityId, reportPath: reports.reportPath, s3Url: reports.s3Url };
const asInput = (r: { entityId: string; reportPath: string | null; s3Url: string | null }, entityType: ReportDeletionInput["entityType"]): ReportDeletionInput =>
  ({ reportPath: r.reportPath || undefined, s3Url: r.s3Url || undefined, entityId: r.entityId, entityType });

/** Storage first, so a failure leaves the rows that point at it for the retry. Never called inside a transaction. */
async function deleteStorage(inputs: ReportDeletionInput[], what: string) {
  if (inputs.length === 0) return;
  const result = await createS3CleanupService().deleteReports(inputs);
  if (!result.success) throw new Error(`Could not delete ${what} storage; will retry`);
}

// Tables whose rows cascade from the target and can be large. Names are constants (never input) and each has an index on the column.
const MONITOR_CHILD_TABLES = ["monitor_aggregates", "monitor_cycles", "alert_history", "alerts", "monitor_aggregate_dedup_audit"] as const;
const JOB_CHILD_TABLES = ["alert_history"] as const;

/** Delete up to one batch of a child table's rows by the target's id; returns how many went. */
async function deleteChildBatch(table: string, column: "monitor_id" | "job_id", id: string): Promise<number> {
  return db.transaction(async (tx) => {
    await limits(tx);
    const result = await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ctid IN (SELECT ctid FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${id} LIMIT ${PURGE_BATCH})`);
    return result.count ?? 0;
  });
}

const progress = (row: DeletionRow, key: string, add: number) => ({ ...row.cursor, [key]: Number(row.cursor?.[key] ?? 0) + add });

export async function purgeMonitorStep(row: DeletionRow): Promise<StepResult> {
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
    await deleteStorage([
      ...batch.filter((r) => r.url).map((r) => ({ reportPath: r.testExecutionId || undefined, s3Url: r.url || undefined, entityId: r.id, entityType: "monitor" as const })),
      ...reportRows.map((r) => asInput(r, "monitor")),
    ], "monitor");
    await db.transaction(async (tx) => {
      await limits(tx);
      if (reportRows.length) await tx.delete(reports).where(inArray(reports.id, reportRows.map((r) => r.id)));
      await tx.delete(monitorResults).where(and(eq(monitorResults.monitorId, monitorId), inArray(monitorResults.id, batch.map((r) => r.id))));
    });
    return { done: false, phase: "results", progress: progress(row, "results", batch.length) };
  }
  if (phase === "children") {
    // Cycles, aggregates and alert history cascade from the monitor row; delete them in batches first so the final delete is small.
    for (const table of MONITOR_CHILD_TABLES) if ((await deleteChildBatch(table, "monitor_id", monitorId)) === PURGE_BATCH) return { done: false, phase: "children" };
    return { done: false, phase: "final" };
  }
  // final: the parent row lock stops new results (their foreign key needs a share lock on it), then verify and delete.
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

export async function purgeJobStep(row: DeletionRow): Promise<StepResult> {
  const jobId = row.targetId;
  const phase = row.phase ?? "unschedule";
  if (phase === "unschedule") {
    await deleteScheduledJob(jobId, { throwOnError: true });
    return { done: false, phase: "drain" };
  }
  if (phase === "drain") {
    const active = await db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.jobId, jobId), inArray(runs.status, ["queued", "running"]))).limit(PURGE_BATCH);
    if (active.length === 0) return { done: false, phase: "runs" };
    const [job] = await db.select({ deletingAt: jobs.deletingAt }).from(jobs).where(eq(jobs.id, jobId));
    if (!job || (job.deletingAt && Date.now() - job.deletingAt.getTime() > DRAIN_MAX_MS)) return { done: false, phase: "runs" };
    await cancelActiveRuns(jobId, active.map((r) => r.id));
    return { done: false, phase: "drain", delayMs: 15_000 };
  }
  if (phase === "runs") {
    const batch = await db.select({ id: runs.id, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata })
      .from(runs).where(sql`${runs.jobId} = ANY(ARRAY[${jobId}]::uuid[])`)
      .orderBy(asc(runs.jobId), sql`${runs.createdAt} desc nulls first`).limit(PURGE_BATCH); // walks runs_job_created_idx; see the monitor batch note
    if (batch.length === 0) return { done: false, phase: "children" };
    const ids = batch.map((r) => r.id);
    // Both lookups are indexed: (entity_type, entity_id) for the run's own reports, and the partial report_path index
    // for the latest-report aliases of saved tests that point into a run directory.
    const own = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports)
      .where(and(inArray(reports.entityType, ["job", "k6_job"]), inArray(reports.entityId, ids)));
    const aliases = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports)
      .where(and(eq(reports.entityType, "test"), inArray(reports.reportPath, ids.map((id) => `${id}/report`))));
    const reportRows = [...new Map([...own, ...aliases].map((r) => [r.id, r])).values()];
    const s3 = createS3CleanupService();
    await deleteStorage([...reportRows.map((r) => asInput(r, r.entityType)), ...batch.flatMap((r) => s3.getRunArtifactInputs(r))], "job run");
    await db.transaction(async (tx) => {
      await limits(tx);
      if (reportRows.length) await tx.delete(reports).where(inArray(reports.id, reportRows.map((r) => r.id)));
      await removeK6RunLinks(tx, ids);
      await tx.delete(runs).where(and(eq(runs.jobId, jobId), inArray(runs.id, ids)));
    });
    return { done: false, phase: "runs", progress: progress(row, "runs", batch.length) };
  }
  if (phase === "children") {
    for (const table of JOB_CHILD_TABLES) if ((await deleteChildBatch(table, "job_id", jobId)) === PURGE_BATCH) return { done: false, phase: "children" };
    return { done: false, phase: "job_reports" };
  }
  if (phase === "job_reports") {
    const own = await db.select({ ...reportColumns, entityType: reports.entityType }).from(reports).where(and(eq(reports.entityId, jobId), eq(reports.entityType, "job")));
    await deleteStorage(own.map((r) => asInput(r, r.entityType)), "job");
    if (own.length) await db.delete(reports).where(inArray(reports.id, own.map((r) => r.id)));
    return { done: false, phase: "final" };
  }
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
