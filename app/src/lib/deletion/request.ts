import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { jobNotificationSettings, jobs, monitorNotificationSettings, monitors, monitorTags, runs, statusPageComponentMonitors } from "@/db/schema";
import { deleteScheduledJob } from "@/lib/job-scheduler";
import { deleteScheduledMonitor } from "@/lib/monitor-scheduler";
import { RUN_CANCELLATION_MARKER, setCancellationSignal } from "@/lib/cancellation-service";
import { DELETION_TX_LIMITS, DELETION_TX_STATEMENT_LIMIT } from "@/lib/resource-deletion/chunks";
import { resolveIncidentsOfDeletedSource } from "@/lib/sre/incident-lifecycle";
import { insertDeletionJob } from "./jobs";
import { triggerDeletion } from "./queue";

/** Redis can be down while the database is up: the flag and purge row are already committed, so never let a slow queue hold the caller. */
const POST_COMMIT_BUDGET_MS = 3000;
const bounded = <T>(work: Promise<T>) => Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, POST_COMMIT_BUDGET_MS).unref())]).catch(() => undefined);
const limit = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
  await tx.execute(sql`SET LOCAL lock_timeout = ${DELETION_TX_LIMITS}`);
  await tx.execute(sql`SET LOCAL statement_timeout = ${DELETION_TX_STATEMENT_LIMIT}`);
};

type Scope = { id: string; projectId: string; organizationId: string; userId: string };
export type DeletionRequest<T> = { status: "requested"; data: T } | { status: "already" } | { status: "not_found" };

/**
 * Phase one of a job delete, in one short transaction: flag the row (it is hidden and refuses new runs from this
 * commit on), cancel queued and running runs, and write the purge row. Everything slow happens in the purge worker.
 */
export async function requestJobDeletion(scope: Scope) {
  const result = await db.transaction(async (tx): Promise<DeletionRequest<{ name: string; description: string | null; cronSchedule: string | null; deletionId: string }>> => {
    await limit(tx);
    const where = and(eq(jobs.id, scope.id), eq(jobs.projectId, scope.projectId), eq(jobs.organizationId, scope.organizationId));
    // FOR UPDATE first: it waits for runs being inserted right now and blocks new ones (see the runs trigger in migration 0075),
    // so the cancellation below sees every run that exists and none can be created afterwards.
    const [current] = await tx.select({ name: jobs.name, description: jobs.description, cronSchedule: jobs.cronSchedule, deletingAt: jobs.deletingAt }).from(jobs).where(where).for("update");
    if (!current) return { status: "not_found" };
    if (current.deletingAt) return { status: "already" };
    await tx.update(jobs).set({ deletingAt: new Date() }).where(eq(jobs.id, scope.id));
    const flagged = { name: current.name, description: current.description, cronSchedule: current.cronSchedule };
    await tx.update(runs).set({ errorDetails: RUN_CANCELLATION_MARKER }).where(and(eq(runs.jobId, scope.id), inArray(runs.status, ["queued", "running"])));
    // Drop the links to shared channels now, so a deleting job never blocks deleting a channel or alerts through it.
    await tx.delete(jobNotificationSettings).where(eq(jobNotificationSettings.jobId, scope.id));
    await resolveIncidentsOfDeletedSource(tx, { organizationId: scope.organizationId, projectId: scope.projectId, sourceType: "job", sourceId: scope.id, targetName: current.name });
    const deletionId = await insertDeletionJob(tx, { scope: "job", targetId: scope.id, organizationId: scope.organizationId, requestedByUserId: scope.userId });
    return { status: "requested", data: { ...flagged, deletionId } };
  });
  // Best effort: the purge repeats the unschedule, and a late scheduled run sees the flag and does nothing.
  if (result.status === "requested") {
    await bounded(Promise.allSettled([
      deleteScheduledJob(scope.id),
      db.select({ id: runs.id }).from(runs).where(and(eq(runs.jobId, scope.id), inArray(runs.status, ["queued", "running"]))).limit(200)
        .then((active) => Promise.allSettled(active.map((run) => setCancellationSignal(run.id)))),
      triggerDeletion(result.data.deletionId),
    ]));
  }
  return result;
}

export async function requestMonitorDeletion(scope: Scope) {
  const result = await db.transaction(async (tx): Promise<DeletionRequest<{ name: string; type: string; target: string; deletionId: string }>> => {
    await limit(tx);
    const where = and(eq(monitors.id, scope.id), eq(monitors.projectId, scope.projectId), eq(monitors.organizationId, scope.organizationId));
    // FOR UPDATE first: it waits for status page links being inserted right now and blocks new ones (trigger in migration 0075).
    const [current] = await tx.select({ name: monitors.name, type: monitors.type, target: monitors.target, deletingAt: monitors.deletingAt }).from(monitors).where(where).for("update");
    if (!current) return { status: "not_found" };
    if (current.deletingAt) return { status: "already" };
    await tx.update(monitors).set({ deletingAt: new Date() }).where(eq(monitors.id, scope.id));
    const flagged = { name: current.name, type: current.type, target: current.target };
    // Public status pages stop showing it at once (indexed by monitor_id); the purge removes the rest.
    await tx.delete(statusPageComponentMonitors).where(eq(statusPageComponentMonitors.monitorId, scope.id));
    // Same for the links to shared tags and channels, so a deleting monitor never blocks deleting them.
    await tx.delete(monitorTags).where(eq(monitorTags.monitorId, scope.id));
    await tx.delete(monitorNotificationSettings).where(eq(monitorNotificationSettings.monitorId, scope.id));
    await resolveIncidentsOfDeletedSource(tx, { organizationId: scope.organizationId, projectId: scope.projectId, sourceType: "monitor", sourceId: scope.id, targetName: current.name });
    const deletionId = await insertDeletionJob(tx, { scope: "monitor", targetId: scope.id, organizationId: scope.organizationId, requestedByUserId: scope.userId });
    return { status: "requested", data: { ...flagged, deletionId } };
  });
  if (result.status === "requested") {
    await bounded(Promise.allSettled([deleteScheduledMonitor(scope.id), triggerDeletion(result.data.deletionId)]));
  }
  return result;
}
