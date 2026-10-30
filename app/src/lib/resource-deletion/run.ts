import { isDeepStrictEqual } from "node:util";
import { db } from "@/utils/db";
import { runs, reports } from "@/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  createS3CleanupService,
  type ReportDeletionInput,
} from "@/lib/s3-cleanup";

// Messages of this class are authored here and safe to show; any other error text may leak DB/S3 detail.
class RetryableDeleteError extends Error {}

type DeleteRunResult = {
  success: boolean;
  message: string;
  error?: string;
  details?: string;
};

type RunData = {
  id: string;
  projectId: string | null;
  jobId: string | null;
  status: string;
  trigger: string;
  startedAt: Date | null;
};

type ReportToDelete = {
  id: string;
  reportPath: string | null;
  s3Url: string | null;
  entityType: ReportDeletionInput["entityType"];
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
  tx: Pick<typeof db, "select">,
  runId: string,
  fallbackInputs: ReportDeletionInput[],
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
      .where(and(
        or(eq(reports.entityId, runId), and(eq(reports.entityType, "test"), eq(reports.reportPath, `${runId}/report`))),
        inArray(reports.entityType, ["job", "test", "k6_job", "k6_test"]),
      ));

    console.log(
      `[DELETE_RUN] Found ${existingReports.length} reports to delete`
    );

    // Store report data for S3 cleanup
    for (const report of existingReports) {
      reportsToDelete.push({
        id: report.id,
        reportPath: report.reportPath,
        s3Url: report.s3Url,
        entityType: report.entityType,
      });
    }

    // Retain database pointers until storage deletion succeeds so retries remain possible.
    if (reportsToDelete.length > 0 || fallbackInputs.length > 0) {
      const cleanup = await createS3CleanupService().deleteReports(
        [...fallbackInputs, ...reportsToDelete.map(report => ({
          reportPath: report.reportPath || undefined,
          s3Url: report.s3Url || undefined,
          entityId: runId,
          entityType: report.entityType,
        }))]
      );
      if (!cleanup.success) throw new RetryableDeleteError("Could not delete run storage; please retry");
    }

    const totalCount = existingReports.length;

    return {
      count: totalCount,
      reportsToDelete,
    };
  } catch (error) {
    console.error("[DELETE_RUN] Error deleting reports:", error);
    if (error instanceof RetryableDeleteError) throw error;
    throw new Error("Failed to delete reports");
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
    success: true as const,
  });
}

export async function deleteRunWithContext(runId: string, context: ProjectAuthContext): Promise<DeleteRunResult> {
  console.log("[DELETE_RUN] Starting deletion for run:", runId);

  if (!runId) {
    console.error("[DELETE_RUN] Error: Run ID is required");
    return {
      success: false as const,
      message: "Failed to delete run",
      error: "Run ID is required",
    };
  }

  try {
    // Get current project context (includes auth verification)
    console.log("[DELETE_RUN] Getting project context...");
    const { userId, project, organizationId } = context;
    console.log("[DELETE_RUN] Project context:", {
      userId: userId.substring(0, 8) + "...",
      projectId: project.id,
      organizationId: organizationId.substring(0, 8) + "...",
    });

    // Check DELETE_JOBS permission (optimized - reuses context from requireProjectContext)
    console.log("[DELETE_RUN] Checking permissions for run deletion...");
    const canDeleteJobs = checkPermissionWithContext("run", "delete", {
      userId,
      organizationId,
      project,
    });
    console.log("[DELETE_RUN] Permission check result:", canDeleteJobs);

    if (!canDeleteJobs) {
      console.warn(
        `[DELETE_RUN] User ${userId} attempted to delete run ${runId} without DELETE_JOBS permission`
      );
      return {
        success: false as const,
        message: "Failed to delete run",
        error: "Insufficient permissions to delete runs",
      };
    }


    // Perform the deletion within a transaction
    console.log("[DELETE_RUN] Starting database transaction...");
    const transactionResult: DeleteTransactionResult = await (async () => {
        const tx = db;
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
            reportS3Url: runs.reportS3Url,
            logsS3Url: runs.logsS3Url,
            metadata: runs.metadata,
          })
          .from(runs)
          .where(and(eq(runs.id, runId), eq(runs.projectId, project.id)))
          .limit(1);

        if (existingRun.length === 0) {
          console.log(
            `[DELETE_RUN] Run with ID ${runId} not found or access denied`
          );
          return {
            success: false as const,
            message: "Failed to delete run",
            error: "Run not found or access denied",
          } as const;
        }

        const runData = existingRun[0];
        if (["queued", "running", "pending"].includes(runData.status)) {
          return { success: false as const, message: "Failed to delete run", error: "Cannot delete an active run; cancel it and retry" } as const;
        }
        console.log(
          `[DELETE_RUN] Found run ${runId}, proceeding with deletion`
        );

        // Delete associated reports
        const reportsResult = await deleteAssociatedReports(tx, runId, createS3CleanupService().getRunArtifactInputs(runData));

        return db.transaction(async (tx) => {
          const [fresh] = await tx.select({id:runs.id,status:runs.status,reportS3Url:runs.reportS3Url,logsS3Url:runs.logsS3Url,metadata:runs.metadata}).from(runs).where(and(eq(runs.id, runId), eq(runs.projectId, project.id))).for("update");
          if (!fresh || fresh.status !== runData.status || fresh.reportS3Url !== runData.reportS3Url || fresh.logsS3Url !== runData.logsS3Url || !isDeepStrictEqual(fresh.metadata, runData.metadata)) {
            throw new RetryableDeleteError("Run changed during cleanup; retry deletion");
          }
          const freshReports = await tx.select({ id: reports.id, reportPath: reports.reportPath, s3Url: reports.s3Url, entityType: reports.entityType }).from(reports).where(and(or(eq(reports.entityId, runId), and(eq(reports.entityType, "test"), eq(reports.reportPath, `${runId}/report`))), inArray(reports.entityType, ["job", "test", "k6_job", "k6_test"]))).for("update");
          if (!isDeepStrictEqual(freshReports.sort((a,b)=>a.id.localeCompare(b.id)), reportsResult.reportsToDelete.sort((a,b)=>a.id.localeCompare(b.id)))) throw new RetryableDeleteError("Run reports changed during cleanup; retry deletion");
          const reportIds = reportsResult.reportsToDelete.map(report => report.id);
          if (reportIds.length) await tx.delete(reports).where(and(inArray(reports.id, reportIds),
            or(eq(reports.entityId, runId), and(eq(reports.entityType, "test"), eq(reports.reportPath, `${runId}/report`)))));
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
            success: true as const,
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
          throw runError;
        }
        });
      })();

    // Handle cleanup tasks outside the transaction
    if (transactionResult.success) {
      console.log(
        "[DELETE_RUN] Transaction successful, starting cleanup tasks..."
      );

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
        success: true as const,
        message: transactionResult.message,
      };
    } else {
      return {
        success: false as const,
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
      success: false as const,
      message: "Failed to delete run",
      error: error instanceof RetryableDeleteError ? errorMessage : "Unexpected error while deleting the run",
      details: "Check server logs for more information",
    };
  }
}
