import { isDeepStrictEqual } from "node:util";
import { db } from "@/utils/db";
import { jobs, jobTests, runs, reports } from "@/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  createS3CleanupService,
  type ReportDeletionInput,
} from "@/lib/s3-cleanup";
import { deleteScheduledJob } from "@/lib/job-scheduler";

type JobDeletionResult = {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
};

export async function deleteJobWithContext(jobId: string, context: ProjectAuthContext): Promise<JobDeletionResult> {
  console.log("[DELETE_JOB] Starting deletion for job:", jobId);

  if (!jobId) {
    console.error("[DELETE_JOB] Error: Job ID is required");
    return {
      success: false as const,
      error: "Job ID is required",
    };
  }

  try {
    // Get current project context (includes auth verification)
    console.log("[DELETE_JOB] Getting project context...");
    const { userId, project, organizationId } = context;

    // Check DELETE_JOBS permission (optimized - reuses context from requireProjectContext)
    console.log("[DELETE_JOB] Checking permissions...");
    const canDeleteJobs = checkPermissionWithContext("job", "delete", {
      userId,
      organizationId,
      project,
    });

    if (!canDeleteJobs) {
      console.warn(
        `[DELETE_JOB] User ${userId} attempted to delete job ${jobId} without DELETE_JOBS permission`
      );
      return {
        success: false as const,
        error: "Insufficient permissions to delete jobs",
      };
    }


    // Perform the deletion within a transaction
    console.log("[DELETE_JOB] Starting database transaction...");
    const transactionResult = await (async () => {
      const tx = db;
      console.log("[DELETE_JOB] Transaction started successfully");

      // Check if the job exists and belongs to current project
      const existingJob = await tx
        .select({
          id: jobs.id,
          name: jobs.name,
          description: jobs.description,
          cronSchedule: jobs.cronSchedule,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.projectId, project.id),
            eq(jobs.organizationId, organizationId)
          )
        )
        .limit(1);

      if (existingJob.length === 0) {
        console.log(
          `[DELETE_JOB] Job with ID ${jobId} not found or access denied`
        );
        return {
          success: false as const,
          error: "Job not found or access denied",
        };
      }

      const jobData = existingJob[0];
      console.log(`[DELETE_JOB] Found job ${jobId}: ${jobData.name}`);

      // Collect all reports that need S3 cleanup before deletion
      console.log("[DELETE_JOB] Collecting reports for S3 cleanup...");
      const allReportsToDelete: Array<{
        id: string;
        reportPath: string | null;
        s3Url: string | null;
        entityType: ReportDeletionInput["entityType"];
        entityId: string;
      }> = [];

      // Get job reports
      const jobReports = await tx
        .select({
          id: reports.id,
          reportPath: reports.reportPath,
          s3Url: reports.s3Url,
          entityType: reports.entityType,
          entityId: reports.entityId,
        })
        .from(reports)
        .where(and(eq(reports.entityId, jobId), eq(reports.entityType, "job")));

      console.log(`[DELETE_JOB] Found ${jobReports.length} job reports`);
      for (const report of jobReports) {
        allReportsToDelete.push({
          id: report.id,
          reportPath: report.reportPath,
          s3Url: report.s3Url,
          entityType: report.entityType,
          entityId: report.entityId,
        });
      }

      // Get all runs associated with this job
      const associatedRuns = await tx
        .select({ id: runs.id, status: runs.status, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata })
        .from(runs)
        .where(eq(runs.jobId, jobId));

      console.log(
        `[DELETE_JOB] Found ${associatedRuns.length} associated runs`
      );

      if (associatedRuns.some(run => ["queued", "running", "pending"].includes(run.status))) {
        return { success: false as const, error: "Cannot delete a job with active runs; cancel them and retry" };
      }

      // Get all reports for these runs
      if (associatedRuns.length > 0) {
        const runIds = associatedRuns.map((run) => run.id);
        console.log(`[DELETE_JOB] Querying reports for ${runIds.length} runs`);

        const runReports = await tx
          .select({
            id: reports.id,
            reportPath: reports.reportPath,
            s3Url: reports.s3Url,
            entityType: reports.entityType,
            entityId: reports.entityId,
          })
          .from(reports)
          .where(or(inArray(reports.entityId, runIds), and(eq(reports.entityType, "test"), inArray(reports.reportPath, runIds.map(id => `${id}/report`)))));

        console.log(
          `[DELETE_JOB] Found ${runReports.length} reports for all runs`
        );
        for (const report of runReports) {
          allReportsToDelete.push({
            id: report.id,
            reportPath: report.reportPath,
            s3Url: report.s3Url,
            entityType: report.entityType,
            entityId: report.entityId,
          });
        }
      }

      console.log(
        `[DELETE_JOB] Total reports to delete: ${allReportsToDelete.length}`
      );

      const s3 = createS3CleanupService();
      const fallbackInputs = associatedRuns.flatMap(run => s3.getRunArtifactInputs(run));
      if (allReportsToDelete.length > 0 || fallbackInputs.length > 0) {
        const inputs: ReportDeletionInput[] = allReportsToDelete.map(report => ({
          reportPath: report.reportPath || undefined,
          s3Url: report.s3Url || undefined,
          entityId: report.entityId,
          entityType: report.entityType,
        }));
        const cleanup = await s3.deleteReports([...inputs, ...fallbackInputs]);
        if (!cleanup.success) throw new Error("Could not delete job storage; please retry");
      }

      return db.transaction(async (tx) => {
      const [freshJob] = await tx.select({id: jobs.id}).from(jobs).where(and(eq(jobs.id, jobId),eq(jobs.projectId,project.id),eq(jobs.organizationId,organizationId))).for("update");
      const freshRuns = await tx.select({ id: runs.id, status: runs.status, reportS3Url: runs.reportS3Url, logsS3Url: runs.logsS3Url, metadata: runs.metadata }).from(runs).where(eq(runs.jobId,jobId)).for("update");
      if (!freshJob || !isDeepStrictEqual(freshRuns.sort((a,b)=>a.id.localeCompare(b.id)), associatedRuns.sort((a,b)=>a.id.localeCompare(b.id)))) throw new Error("Job runs changed during cleanup; retry deletion");
      const ownedIds = associatedRuns.map(run => run.id);
      const freshReports = await tx.select({ id: reports.id, reportPath: reports.reportPath, s3Url: reports.s3Url, entityType: reports.entityType, entityId: reports.entityId }).from(reports).where(or(and(eq(reports.entityId, jobId), eq(reports.entityType, "job")), ownedIds.length ? or(inArray(reports.entityId, ownedIds), and(eq(reports.entityType, "test"), inArray(reports.reportPath, ownedIds.map(id=>`${id}/report`)))) : undefined)).for("update");
      if (!isDeepStrictEqual(freshReports.sort((a,b)=>a.id.localeCompare(b.id)), allReportsToDelete.sort((a,b)=>a.id.localeCompare(b.id)))) throw new Error("Job reports changed during cleanup; retry deletion");
      // Delete only the pointers collected and rechecked, never newly inserted report rows.
      if (allReportsToDelete.length) await tx.delete(reports).where(inArray(reports.id, allReportsToDelete.map(report => report.id)));

      // Delete test runs associated with this job
      console.log("[DELETE_JOB] Deleting associated runs...");
      const deletedRuns = await tx
        .delete(runs)
        .where(eq(runs.jobId, jobId))
        .returning({ id: runs.id });
      console.log(`[DELETE_JOB] Deleted ${deletedRuns.length} runs`);

      // Delete job-test associations
      console.log("[DELETE_JOB] Deleting job-test associations...");
      await tx.delete(jobTests).where(eq(jobTests.jobId, jobId));
      console.log("[DELETE_JOB] Job-test associations deleted");

      // Finally delete the job itself
      console.log("[DELETE_JOB] Deleting job...");
      const deletedJobs = await tx
        .delete(jobs)
        .where(eq(jobs.id, jobId))
        .returning({ id: jobs.id });

      if (deletedJobs.length === 0) {
        throw new Error(`Failed to delete job ${jobId} - no rows affected`);
      }

      console.log("[DELETE_JOB] Transaction completed successfully");
      return {
        success: true as const,
        jobData,
        reportsToDelete: allReportsToDelete,
        deletedRuns: deletedRuns.length,
        deletedReports: allReportsToDelete.length,
      };
      });
    })();

    // Handle cleanup tasks outside the transaction
    if (transactionResult.success && "jobData" in transactionResult) {
      console.log(
        "[DELETE_JOB] Transaction successful, starting cleanup tasks..."
      );

      // Unschedule the job from BullMQ to stop execution
      try {
        console.log("[DELETE_JOB] Unscheduling job from BullMQ...");
        const unscheduled = await deleteScheduledJob(jobId);
        if (unscheduled) {
          console.log(`[DELETE_JOB] Successfully unscheduled job ${jobId}`);
        } else {
          console.log(
            `[DELETE_JOB] No BullMQ schedule found for job ${jobId} (may not have been scheduled)`
          );
        }
      } catch (scheduleError) {
        console.error(
          "[DELETE_JOB] Error unscheduling job (job still deleted):",
          scheduleError
        );
        // Continue with other cleanup even if unscheduling fails
      }

      // Log the audit event for job deletion
      await logAuditEvent({
        userId,
        action: "job_deleted",
        resource: "job",
        resourceId: jobId,
        metadata: {
          organizationId,
          jobName: transactionResult.jobData?.name,
          jobDescription: transactionResult.jobData?.description,
          cronSchedule: transactionResult.jobData?.cronSchedule,
          projectId: project.id,
          projectName: project.name,
          runsDeleted: transactionResult.deletedRuns,
          reportsDeleted: transactionResult.deletedReports,
        },
        success: true as const,
      }).catch((_auditError) => {
        console.error(
          "[DELETE_JOB] Error logging audit event (job still deleted):",
          _auditError
        );
      });

      // Revalidate paths
      try {
        console.log("[DELETE_JOB] Revalidating paths...");
        revalidatePath("/jobs");
        revalidatePath("/runs");
        revalidatePath("/");
        console.log("[DELETE_JOB] Paths revalidated successfully");
      } catch (revalidateError) {
        console.error(
          "[DELETE_JOB] Error revalidating paths (job still deleted):",
          revalidateError
        );
      }

      console.log(
        `[DELETE_JOB] Successfully deleted job ${jobId} with ${transactionResult.deletedRuns} runs and ${transactionResult.deletedReports} reports`
      );

      return {
        success: true as const,
        message: `Job deleted successfully (including ${transactionResult.deletedRuns} runs and ${transactionResult.deletedReports} reports)`,
      };
    } else if (!transactionResult.success) {
      return {
        success: false as const,
        error: transactionResult.error,
      };
    }

    return {
      success: false as const,
      error: "Unexpected transaction result",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE_JOB] Unexpected error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : "No stack available",
    });

    return {
      success: false as const,
      error: errorMessage,
      details: "Check server logs for more information",
    };
  }
}
