import { and, asc, eq, gt, gte, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { deletionJobs, jobs, monitors, organization, projects, runs, statusPages } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { RUN_CANCELLATION_MARKER, setCancellationSignal } from "@/lib/cancellation-service";
import { deleteScheduledJob } from "@/lib/job-scheduler";
import { reconcileMonitorSchedule } from "@/lib/monitor-schedule-reconcile";
import { closeDeletionJobs, insertDeletionJob } from "./jobs";
import { invalidateProjectState, PROJECT_RESTORE_DAYS } from "./org-state";

export class ProjectDeletionError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 409, readonly code: string) { super(message); }
}

type ArchivedPage = { id: string; status: string };
const BATCH = 100;

/**
 * Soft delete: hidden everywhere (status 'deleted'), restorable for PROJECT_RESTORE_DAYS, then purged by the worker.
 * One timestamp covers the project, its paused monitors and archived status pages, so restore can tell exactly what
 * this delete changed (rows touched at or after deleted_at); the pages' previous states are kept on the purge row.
 */
export async function softDeleteProject(input: { projectId: string; actorUserId: string }) {
  const at = new Date();
  const purgeAfter = new Date(at.getTime() + PROJECT_RESTORE_DAYS * 24 * 60 * 60_000);
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const [deleted] = await tx.update(projects).set({ status: "deleted", deletedAt: at, purgeAfter, updatedAt: at })
      .where(and(eq(projects.id, input.projectId), ne(projects.status, "deleted")))
      .returning({ name: projects.name, slug: projects.slug, description: projects.description, organizationId: projects.organizationId });
    if (!deleted) return null;
    const pausedMonitors = await tx.update(monitors).set({ status: "paused", updatedAt: at })
      .where(and(eq(monitors.projectId, input.projectId), ne(monitors.status, "paused"))).returning({ id: monitors.id, scheduledJobId: monitors.scheduledJobId });
    // Its public status pages would otherwise stay live with no way to manage them.
    const archivedPages = await tx.select({ id: statusPages.id, status: statusPages.status }).from(statusPages)
      .where(and(eq(statusPages.projectId, input.projectId), ne(statusPages.status, "archived")));
    if (archivedPages.length) await tx.update(statusPages).set({ status: "archived", updatedAt: at }).where(inArray(statusPages.id, archivedPages.map((page) => page.id)));
    // Due at purge_after: the sweep triggers it then. (No trigger now: a long-delayed queue job would shadow later triggers.)
    const deletionId = await insertDeletionJob(tx, { scope: "project", targetId: input.projectId, organizationId: deleted.organizationId, requestedByUserId: input.actorUserId, nextAttemptAt: purgeAfter });
    await tx.update(deletionJobs).set({ cursor: { archivedPages: archivedPages satisfies ArchivedPage[] } }).where(eq(deletionJobs.id, deletionId));
    return { deleted, pausedMonitors, deletionId };
  });
  if (!outcome) return null;
  invalidateProjectState(input.projectId);
  await logAuditEvent({
    userId: input.actorUserId, organizationId: outcome.deleted.organizationId, action: "project_deleted", resource: "project", resourceId: input.projectId,
    metadata: { projectName: outcome.deleted.name, projectSlug: outcome.deleted.slug, description: outcome.deleted.description, organizationId: outcome.deleted.organizationId, purgeAfter: purgeAfter.toISOString() },
    success: true,
  });
  await stopProjectActivity(input.projectId, outcome.pausedMonitors);
  return { ...outcome.deleted, purgeAfter };
}

/** Best effort after commit: the schedulers also refuse deleted projects, so a failure here only leaves a no-op repeatable. */
async function stopProjectActivity(projectId: string, pausedMonitors: Array<{ id: string; scheduledJobId: string | null }>) {
  try {
    const { unscheduleMonitors } = await import("@/lib/execution/trial-lifecycle");
    await unscheduleMonitors(pausedMonitors, db);
  } catch (error) { console.error("Failed to unschedule monitors for deleted project", projectId, error); }
  try {
    for (let after: string | undefined; ;) {
      const page = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.projectId, projectId), isNotNull(jobs.cronSchedule), after ? gt(jobs.id, after) : undefined)).orderBy(asc(jobs.id)).limit(BATCH);
      if (page.length === 0) break;
      after = page[page.length - 1].id;
      await Promise.all(page.map((job) => deleteScheduledJob(job.id)));
    }
    for (;;) {
      const active = await db.select({ id: runs.id }).from(runs)
        .where(and(eq(runs.projectId, projectId), inArray(runs.status, ["queued", "running"]), or(sql`${runs.errorDetails} IS NULL`, ne(runs.errorDetails, RUN_CANCELLATION_MARKER)))).limit(BATCH);
      if (active.length === 0) break;
      const ids = active.map((run) => run.id);
      await db.update(runs).set({ errorDetails: RUN_CANCELLATION_MARKER }).where(and(inArray(runs.id, ids), inArray(runs.status, ["queued", "running"])));
      await Promise.allSettled(ids.map((id) => setCancellationSignal(id)));
    }
  } catch (error) { console.error("Failed to stop activity of deleted project", projectId, error); }
}

/** Undo a soft delete inside the restore window (checked under the row lock the purge's first step also takes). */
export async function restoreProject(input: { projectId: string; actorUserId: string }) {
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    const [project] = await tx.select({ deletedAt: projects.deletedAt, expired: sql<boolean>`${projects.purgeAfter} <= now()`, status: projects.status, name: projects.name, organizationId: projects.organizationId })
      .from(projects).where(eq(projects.id, input.projectId)).for("update");
    if (!project || project.status !== "deleted" || !project.deletedAt) throw new ProjectDeletionError("Project not found", 404, "NOT_FOUND");
    if (project.expired) throw new ProjectDeletionError("The restore window has ended", 409, "RESTORE_WINDOW_ENDED");
    // Admitting work reads the organization fresh, under the same transaction: a pending organization stays read-only.
    const [org] = await tx.select({ pending: organization.deletionRequestedAt }).from(organization).where(eq(organization.id, project.organizationId));
    if (org?.pending) throw new ProjectDeletionError("This organization is scheduled for deletion and read-only", 403, "ORG_PENDING_DELETION");
    const [purge] = await tx.select({ cursor: deletionJobs.cursor, state: deletionJobs.state }).from(deletionJobs)
      .where(and(eq(deletionJobs.scope, "project"), eq(deletionJobs.targetId, input.projectId), ne(deletionJobs.state, "completed"))).for("update");
    if (purge?.state === "running") throw new ProjectDeletionError("The project is being purged", 409, "PURGE_STARTED");
    const at = new Date();
    await tx.update(projects).set({ status: "active", deletedAt: null, purgeAfter: null, updatedAt: at }).where(eq(projects.id, input.projectId));
    const resumed = await tx.update(monitors).set({ status: "pending", updatedAt: at })
      .where(and(eq(monitors.projectId, input.projectId), eq(monitors.status, "paused"), gte(monitors.updatedAt, project.deletedAt), sql`${monitors.deletingAt} IS NULL`))
      .returning({ id: monitors.id });
    const pages = ((purge?.cursor as { archivedPages?: ArchivedPage[] } | undefined)?.archivedPages ?? []);
    for (const previous of new Set(pages.map((page) => page.status))) {
      await tx.update(statusPages).set({ status: previous as typeof statusPages.$inferSelect.status, updatedAt: at })
        .where(and(inArray(statusPages.id, pages.filter((page) => page.status === previous).map((page) => page.id)), eq(statusPages.status, "archived")));
    }
    await closeDeletionJobs(tx, "project", input.projectId);
    return { project, resumed };
  });
  invalidateProjectState(input.projectId);
  await logAuditEvent({ userId: input.actorUserId, organizationId: outcome.project.organizationId, action: "project_restored", resource: "project", resourceId: input.projectId, metadata: { projectName: outcome.project.name }, success: true });
  // Re-create schedules after the commit; a failure is repaired by the periodic monitor schedule repair and job init.
  await Promise.allSettled(outcome.resumed.map((monitor) => reconcileMonitorSchedule(monitor.id, input.projectId)));
  try {
    const { scheduleJob } = await import("@/lib/job-scheduler");
    const { getNextRunDate } = await import("@/lib/scheduler/cron-utils");
    const scheduled = await db.select({ id: jobs.id, name: jobs.name, cron: jobs.cronSchedule }).from(jobs).where(and(eq(jobs.projectId, input.projectId), isNotNull(jobs.cronSchedule), sql`${jobs.deletingAt} IS NULL`));
    for (const job of scheduled) {
      const schedulerId = await scheduleJob({ name: job.name, cron: job.cron!, jobId: job.id, retryLimit: 3 });
      await db.update(jobs).set({ scheduledJobId: schedulerId, nextRunAt: getNextRunDate(job.cron!) }).where(eq(jobs.id, job.id));
    }
  } catch (error) { console.error("Failed to reschedule jobs of restored project", input.projectId, error); }
  return outcome.project;
}

/** Soft-deleted projects of an organization still inside their restore window (for the restore list). */
export async function listDeletedProjects(organizationId: string) {
  return db.select({ id: projects.id, name: projects.name, deletedAt: projects.deletedAt, purgeAfter: projects.purgeAfter }).from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.status, "deleted"), isNotNull(projects.deletedAt))).orderBy(asc(projects.deletedAt));
}
