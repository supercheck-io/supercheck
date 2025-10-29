"use server";

import { db } from "../utils/db";
import { jobs, jobTests, runs, reports } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
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

export async function deleteJob(jobId: string): Promise<JobDeletionResult> {
  console.log("[DELETE_JOB] Starting deletion for job:", jobId);

  if (!jobId) {
    console.error("[DELETE_JOB] Error: Job ID is required");
    return {
      success: false,
      error: "Job ID is required",
    };
  }

  try {
    // Get current project context (includes auth verification)
    console.log("[DELETE_JOB] Getting project context...");
    const { userId, project, organizationId } = await requireProjectContext();

    // Check DELETE_JOBS permission
    console.log("[DELETE_JOB] Checking permissions...");
    const canDeleteJobs = await hasPermission("job", "delete", {
      organizationId,
      projectId: project.id,
    });

    if (!canDeleteJobs) {
      console.warn(
        `[DELETE_JOB] User ${userId} attempted to delete job ${jobId} without DELETE_JOBS permission`
      );
      return {
        success: false,
        error: "Insufficient permissions to delete jobs",
      };
    }

    // Perform the deletion within a transaction
    console.log("[DELETE_JOB] Starting database transaction...");
    const transactionResult = await db.transaction(async (tx) => {
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
          success: false,
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
        entityType: "job" | "test";
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
          entityType: report.entityType as "job" | "test",
          entityId: report.entityId,
        });
      }

      // Get all runs associated with this job
      const associatedRuns = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.jobId, jobId));

      console.log(
        `[DELETE_JOB] Found ${associatedRuns.length} associated runs`
      );

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
          .where(inArray(reports.entityId, runIds));

        console.log(
          `[DELETE_JOB] Found ${runReports.length} reports for all runs`
        );
        for (const report of runReports) {
          allReportsToDelete.push({
            id: report.id,
            reportPath: report.reportPath,
            s3Url: report.s3Url,
            entityType: report.entityType as "job" | "test",
            entityId: report.entityId,
          });
        }
      }

      console.log(
        `[DELETE_JOB] Total reports to delete: ${allReportsToDelete.length}`
      );

      // Delete reports from database (for all runs and the job)
      if (allReportsToDelete.length > 0) {
        console.log("[DELETE_JOB] Deleting reports from database...");

        // Delete run reports
        if (associatedRuns.length > 0) {
          const runIds = associatedRuns.map((run) => run.id);
          const deletedRunReports = await tx
            .delete(reports)
            .where(inArray(reports.entityId, runIds))
            .returning({ id: reports.id });
          console.log(
            `[DELETE_JOB] Deleted ${deletedRunReports.length} run reports`
          );
        }

        // Delete job reports
        const deletedJobReports = await tx
          .delete(reports)
          .where(
            and(eq(reports.entityId, jobId), eq(reports.entityType, "job"))
          )
          .returning({ id: reports.id });
        console.log(
          `[DELETE_JOB] Deleted ${deletedJobReports.length} job reports`
        );

        console.log("[DELETE_JOB] All reports deleted from database");
      }

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
        success: true,
        jobData,
        reportsToDelete: allReportsToDelete,
        deletedRuns: deletedRuns.length,
        deletedReports: allReportsToDelete.length,
      };
    });

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

      // S3 cleanup - run asynchronously (fire-and-forget) to avoid blocking the response
      if (
        transactionResult.reportsToDelete &&
        transactionResult.reportsToDelete.length > 0
      ) {
        console.log(
          `[DELETE_JOB] Scheduling S3 cleanup for ${transactionResult.reportsToDelete.length} reports (background)...`
        );

        // Run S3 cleanup in background without awaiting
        void (async () => {
          try {
            const s3Service = createS3CleanupService();

            // Convert reports to S3 deletion format
            const s3DeletionInputs: ReportDeletionInput[] =
              transactionResult.reportsToDelete!.map((report) => ({
                reportPath: report.reportPath || undefined,
                s3Url: report.s3Url || undefined,
                entityId: report.entityId,
                entityType: report.entityType,
              }));

            const s3Result = await s3Service.deleteReports(s3DeletionInputs);

            if (s3Result.success) {
              console.log(
                `[DELETE_JOB] Background S3 cleanup successful: ${s3Result.deletedObjects.length} objects deleted`
              );
            } else {
              console.warn(
                `[DELETE_JOB] Background S3 cleanup partially failed: ${s3Result.deletedObjects.length} succeeded, ${s3Result.failedObjects.length} failed`
              );
              for (const failed of s3Result.failedObjects) {
                console.warn(
                  `[DELETE_JOB] S3 deletion failed for ${failed.key}: ${failed.error}`
                );
              }
            }
          } catch (s3Error) {
            console.error(
              "[DELETE_JOB] Background S3 cleanup error:",
              s3Error
            );
          }
        })();
      } else {
        console.log("[DELETE_JOB] No S3 reports to clean up");
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
        success: true,
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
        success: true,
        message: `Job deleted successfully (including ${transactionResult.deletedRuns} runs and ${transactionResult.deletedReports} reports)`,
      };
    } else if (!transactionResult.success) {
      return {
        success: false,
        error: transactionResult.error,
      };
    }

    return {
      success: false,
      error: "Unexpected transaction result",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE_JOB] Unexpected error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : "No stack available",
    });

    return {
      success: false,
      error: errorMessage,
      details: "Check server logs for more information",
    };
  }
}
