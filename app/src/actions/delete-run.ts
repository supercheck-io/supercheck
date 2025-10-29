"use server";

import { db } from "../utils/db";
import { runs, reports } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  createS3CleanupService,
  type ReportDeletionInput,
} from "@/lib/s3-cleanup";

type DeleteRunResult = {
  success: boolean;
  message: string;
  error?: string;
  details?: string;
};

type RunData = {
  id: string;
  projectId: string | null;
  jobId: string;
  status: string;
  trigger: string;
  startedAt: Date | null;
};

type ReportToDelete = {
  id: string;
  reportPath: string | null;
  s3Url: string | null;
  entityType: "job" | "test";
};

type DeleteTransactionResult =
  | {
      success: true;
      message: string;
      runData: RunData;
      reportsCount: number;
      reportsToDelete: ReportToDelete[];
    }
  | {
      success: false;
      message: string;
      error: string;
      details?: string;
    };

/**
 * Delete associated reports for a run and return S3 cleanup data
 */
async function deleteAssociatedReports(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  runId: string
): Promise<{ count: number; reportsToDelete: ReportToDelete[] }> {
  console.log(`[DELETE_RUN] Deleting reports for run ${runId}`);
  const reportsToDelete: ReportToDelete[] = [];

  try {
    // First, get the report data before deleting (for S3 cleanup)
    const existingReports = await tx
      .select({
        id: reports.id,
        reportPath: reports.reportPath,
        s3Url: reports.s3Url,
        entityType: reports.entityType,
      })
      .from(reports)
      .where(eq(reports.entityId, runId));

    console.log(
      `[DELETE_RUN] Found ${existingReports.length} reports to delete`
    );

    // Store report data for S3 cleanup
    for (const report of existingReports) {
      reportsToDelete.push({
        id: report.id,
        reportPath: report.reportPath,
        s3Url: report.s3Url,
        entityType: report.entityType as "job" | "test",
      });
    }

    // Delete job-type reports
    const deletedJobReports = await tx
      .delete(reports)
      .where(and(eq(reports.entityId, runId), eq(reports.entityType, "job")))
      .returning({ id: reports.id });

    console.log(
      `[DELETE_RUN] Deleted ${deletedJobReports.length} job-type reports`
    );

    // Delete test-type reports
    const deletedTestReports = await tx
      .delete(reports)
      .where(and(eq(reports.entityId, runId), eq(reports.entityType, "test")))
      .returning({ id: reports.id });

    console.log(
      `[DELETE_RUN] Deleted ${deletedTestReports.length} test-type reports`
    );

    const totalCount = deletedJobReports.length + deletedTestReports.length;
    console.log(`[DELETE_RUN] Total reports deleted: ${totalCount}`);

    return {
      count: totalCount,
      reportsToDelete,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[DELETE_RUN] Error deleting reports:", message);
    throw new Error(`Failed to delete reports: ${message}`);
  }
}

/**
 * Log audit event for run deletion
 */
async function logRunDeletionAudit(
  userId: string,
  organizationId: string,
  runId: string,
  runData: RunData,
  projectId: string,
  projectName: string,
  reportsCount: number
): Promise<void> {
  return logAuditEvent({
    userId,
    action: "run_deleted",
    resource: "run",
    resourceId: runId,
    metadata: {
      organizationId,
      jobId: runData.jobId,
      status: runData.status,
      trigger: runData.trigger,
      startedAt: runData.startedAt?.toISOString(),
      projectId,
      projectName,
      reportsDeleted: reportsCount,
    },
    success: true,
  });
}

export async function deleteRun(runId: string): Promise<DeleteRunResult> {
  console.log("[DELETE_RUN] Starting deletion for run:", runId);

  if (!runId) {
    console.error("[DELETE_RUN] Error: Run ID is required");
    return {
      success: false,
      message: "Failed to delete run",
      error: "Run ID is required",
    };
  }

  try {
    // Get current project context (includes auth verification)
    console.log("[DELETE_RUN] Getting project context...");
    const { userId, project, organizationId } = await requireProjectContext();
    console.log("[DELETE_RUN] Project context:", {
      userId: userId.substring(0, 8) + "...",
      projectId: project.id,
      organizationId: organizationId.substring(0, 8) + "...",
    });

    // Check DELETE_JOBS permission (runs are considered part of job management)
    console.log("[DELETE_RUN] Checking permissions for run deletion...");
    const canDeleteJobs = await hasPermission("run", "delete", {
      organizationId,
      projectId: project.id,
    });
    console.log("[DELETE_RUN] Permission check result:", canDeleteJobs);

    if (!canDeleteJobs) {
      console.warn(
        `[DELETE_RUN] User ${userId} attempted to delete run ${runId} without DELETE_JOBS permission`
      );
      return {
        success: false,
        message: "Failed to delete run",
        error: "Insufficient permissions to delete runs",
      };
    }

    // Perform the deletion within a transaction
    console.log("[DELETE_RUN] Starting database transaction...");
    const transactionResult: DeleteTransactionResult = await db.transaction(
      async (tx) => {
        console.log("[DELETE_RUN] Transaction started successfully");

        // Check if the run exists and belongs to the current project
        const existingRun = await tx
          .select({
            id: runs.id,
            projectId: runs.projectId,
            jobId: runs.jobId,
            status: runs.status,
            trigger: runs.trigger,
            startedAt: runs.startedAt,
          })
          .from(runs)
          .where(and(eq(runs.id, runId), eq(runs.projectId, project.id)))
          .limit(1);

        if (existingRun.length === 0) {
          console.log(
            `[DELETE_RUN] Run with ID ${runId} not found or access denied`
          );
          return {
            success: false,
            message: "Failed to delete run",
            error: "Run not found or access denied",
          } as const;
        }

        const runData = existingRun[0];
        console.log(
          `[DELETE_RUN] Found run ${runId}, proceeding with deletion`
        );

        // Delete associated reports
        const reportsResult = await deleteAssociatedReports(tx, runId);

        // Now delete the run
        console.log(`[DELETE_RUN] Now deleting run with ID: ${runId}`);
        try {
          const deletedRuns = await tx
            .delete(runs)
            .where(eq(runs.id, runId))
            .returning({ id: runs.id });

          console.log(
            `[DELETE_RUN] Successfully deleted run with ID: ${runId} from project ${project.name} by user ${userId}, count: ${deletedRuns.length}`
          );

          if (deletedRuns.length === 0) {
            throw new Error(`Failed to delete run ${runId} - no rows affected`);
          }

          console.log(
            "[DELETE_RUN] Transaction completed successfully - run and reports deleted"
          );
          return {
            success: true,
            message: `Run deleted successfully (including ${reportsResult.count} reports)`,
            runData,
            reportsCount: reportsResult.count,
            reportsToDelete: reportsResult.reportsToDelete,
          } as const;
        } catch (runError) {
          console.error("[DELETE_RUN] Error deleting run:", runError);
          console.error(
            "[DELETE_RUN] Run error stack:",
            runError instanceof Error ? runError.stack : "No stack available"
          );
          throw new Error(
            `Failed to delete run: ${
              runError instanceof Error ? runError.message : String(runError)
            }`
          );
        }
      }
    );

    // Handle cleanup tasks outside the transaction
    if (transactionResult.success) {
      console.log(
        "[DELETE_RUN] Transaction successful, starting cleanup tasks..."
      );

      // S3 cleanup - run asynchronously (fire-and-forget) to avoid blocking the response
      if (transactionResult.reportsToDelete.length > 0) {
        console.log(
          `[DELETE_RUN] Scheduling S3 cleanup for ${transactionResult.reportsToDelete.length} reports (background)...`
        );

        // Run S3 cleanup in background without awaiting
        void (async () => {
          try {
            const s3Service = createS3CleanupService();

            // Convert reports to S3 deletion format
            const s3DeletionInputs: ReportDeletionInput[] =
              transactionResult.reportsToDelete.map((report) => ({
                reportPath: report.reportPath || undefined,
                s3Url: report.s3Url || undefined,
                entityId: runId,
                entityType: report.entityType,
              }));

            const s3Result = await s3Service.deleteReports(s3DeletionInputs);

            if (s3Result.success) {
              console.log(
                `[DELETE_RUN] Background S3 cleanup successful: ${s3Result.deletedObjects.length} objects deleted`
              );
            } else {
              console.warn(
                `[DELETE_RUN] Background S3 cleanup partially failed: ${s3Result.deletedObjects.length} succeeded, ${s3Result.failedObjects.length} failed`
              );
              // Log failed objects for debugging
              for (const failed of s3Result.failedObjects) {
                console.warn(
                  `[DELETE_RUN] S3 deletion failed for ${failed.key}: ${failed.error}`
                );
              }
            }
          } catch (s3Error) {
            console.error(
              "[DELETE_RUN] Background S3 cleanup error:",
              s3Error
            );
          }
        })();
      } else {
        console.log("[DELETE_RUN] No S3 reports to clean up");
      }

      // Log audit event (don't fail the whole operation if this fails)
      await logRunDeletionAudit(
        userId,
        organizationId,
        runId,
        transactionResult.runData,
        project.id,
        project.name,
        transactionResult.reportsCount
      ).catch((auditError) => {
        console.error(
          "[DELETE_RUN] Error logging audit event (run still deleted):",
          auditError
        );
      });

      // Revalidate paths (don't fail the whole operation if this fails)
      try {
        console.log("[DELETE_RUN] Revalidating paths...");
        revalidatePath("/runs");
        revalidatePath("/");
        revalidatePath("/jobs");
        revalidatePath(`/runs/${runId}`);
        console.log("[DELETE_RUN] Paths revalidated successfully");
      } catch (revalidateError) {
        console.error(
          "[DELETE_RUN] Error revalidating paths (run still deleted):",
          revalidateError
        );
      }
    }

    console.log("[DELETE_RUN] Returning final result");
    if (transactionResult.success) {
      return {
        success: true,
        message: transactionResult.message,
      };
    } else {
      return {
        success: false,
        message: transactionResult.message,
        error: transactionResult.error,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE_RUN] Unexpected error:", {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : "No stack available",
    });

    return {
      success: false,
      message: "Failed to delete run",
      error: errorMessage,
      details: "Check server logs for more information",
    };
  }
}
