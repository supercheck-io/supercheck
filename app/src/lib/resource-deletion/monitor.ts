import { isDeepStrictEqual } from "node:util";
import { db } from "@/utils/db";
import { monitors, monitorResults, reports } from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { deleteScheduledMonitor } from "@/lib/monitor-scheduler";
import { createS3CleanupService } from "@/lib/s3-cleanup";

type MonitorDeletionResult = {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
};

export async function deleteMonitorWithContext(
  monitorId: string,
  context: ProjectAuthContext,
): Promise<MonitorDeletionResult> {
  if (!monitorId) {
    console.error("[DELETE_MONITOR] Error: Monitor ID is required");
    return {
      success: false as const,
      error: "Monitor ID is required",
    };
  }

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = context;

    // Check DELETE_MONITORS permission (optimized - reuses context from requireProjectContext)
    const canDeleteMonitors = checkPermissionWithContext("monitor", "delete", {
      userId,
      organizationId,
      project,
    });

    if (!canDeleteMonitors) {
      console.warn(
        `[DELETE_MONITOR] User ${userId} attempted to delete monitor ${monitorId} without permission`
      );
      return {
        success: false as const,
        error: "Insufficient permissions to delete monitors",
      };
    }


    // Finish storage cleanup before opening a short, guarded deletion transaction.
    const transactionResult = await (async () => {
      const tx = db;
      // Verify monitor belongs to current project before deletion - get details for audit
      const existingMonitor = await tx
        .select({
          id: monitors.id,
          name: monitors.name,
          type: monitors.type,
          target: monitors.target,
        })
        .from(monitors)
        .where(
          and(
            eq(monitors.id, monitorId),
            eq(monitors.projectId, project.id),
            eq(monitors.organizationId, organizationId)
          )
        )
        .limit(1);

      if (existingMonitor.length === 0) {
        return {
          success: false as const,
          error: "Monitor not found or access denied",
        };
      }

      const monitorData = existingMonitor[0];

      // Collect all monitor results with S3 reports that need cleanup
      const resultsWithReports = await tx
        .select({
          id: monitorResults.id,
          testExecutionId: monitorResults.testExecutionId,
          testReportS3Url: monitorResults.testReportS3Url,
        })
        .from(monitorResults)
        .where(eq(monitorResults.monitorId, monitorId));

      const executionIds = resultsWithReports.flatMap(result => result.testExecutionId ? [result.testExecutionId] : []);
      const urls = resultsWithReports.flatMap(result => result.testReportS3Url ? [result.testReportS3Url] : []);
      const reportOwnership = and(eq(reports.entityType, "monitor"), or(
        executionIds.length ? inArray(reports.entityId, executionIds) : undefined,
        urls.length ? inArray(reports.s3Url, urls) : undefined,
      ));
      const reportRows = executionIds.length || urls.length ? await tx.select({
        id: reports.id, entityId: reports.entityId, reportPath: reports.reportPath, s3Url: reports.s3Url,
      }).from(reports).where(reportOwnership) : [];

      // Filter results that have S3 reports
      const reportsToDelete = resultsWithReports.filter(
        (result) => result.testReportS3Url || result.testExecutionId
      );

      if (reportsToDelete.length > 0 || reportRows.length > 0) {
        const cleanup = await createS3CleanupService().deleteReports(
          [...reportsToDelete.map(report => ({
            reportPath: report.testExecutionId || undefined,
            s3Url: report.testReportS3Url || undefined,
            entityId: report.id,
            entityType: "monitor" as const,
          })), ...reportRows.map(report => ({
            reportPath: report.reportPath || undefined, s3Url: report.s3Url || undefined,
            entityId: report.entityId, entityType: "monitor" as const,
          }))]
        );
        if (!cleanup.success) throw new Error("Could not delete monitor storage; please retry");
      }

      return db.transaction(async (tx) => {
      const [freshMonitor] = await tx.select({id: monitors.id}).from(monitors).where(and(eq(monitors.id,monitorId),eq(monitors.projectId,project.id),eq(monitors.organizationId,organizationId))).for("update");
      const freshResults = await tx.select({ id: monitorResults.id, testExecutionId: monitorResults.testExecutionId, testReportS3Url: monitorResults.testReportS3Url }).from(monitorResults).where(eq(monitorResults.monitorId,monitorId)).for("update");
      if (!freshMonitor || !isDeepStrictEqual(freshResults.sort((a,b)=>a.id.localeCompare(b.id)), resultsWithReports.sort((a,b)=>a.id.localeCompare(b.id)))) throw new Error("Monitor results changed during cleanup; retry deletion");
      const freshReports = executionIds.length || urls.length ? await tx.select({
        id: reports.id, entityId: reports.entityId, reportPath: reports.reportPath, s3Url: reports.s3Url,
      }).from(reports).where(reportOwnership).for("update") : [];
      if (!isDeepStrictEqual(freshReports.sort((a,b)=>a.id.localeCompare(b.id)), reportRows.sort((a,b)=>a.id.localeCompare(b.id)))) {
        throw new Error("Monitor reports changed during cleanup; retry deletion");
      }
      if (reportRows.length) await tx.delete(reports).where(inArray(reports.id, reportRows.map(report => report.id)));
      // Delete monitor results from database
      const deletedResults = await tx
        .delete(monitorResults)
        .where(eq(monitorResults.monitorId, monitorId))
        .returning({ id: monitorResults.id });

      // Delete the monitor (with project scoping for extra safety)
      const deletedMonitors = await tx
        .delete(monitors)
        .where(
          and(
            eq(monitors.id, monitorId),
            eq(monitors.projectId, project.id),
            eq(monitors.organizationId, organizationId)
          )
        )
        .returning({ id: monitors.id });

      if (deletedMonitors.length === 0) {
        throw new Error(
          `Failed to delete monitor ${monitorId} - no rows affected`
        );
      }

      return {
        success: true as const,
        monitorData,
        reportsToDelete,
        deletedResults: deletedResults.length,
      };
      });
    })();

    // Handle cleanup tasks outside the transaction
    if (transactionResult.success && "monitorData" in transactionResult) {
      console.log(
        "[DELETE_MONITOR] Transaction successful, starting cleanup tasks..."
      );

      // Unschedule the monitor from Redis to stop execution
      try {
        console.log("[DELETE_MONITOR] Unscheduling monitor from Redis...");
        await deleteScheduledMonitor(monitorId);
        console.log(
          `[DELETE_MONITOR] Successfully unscheduled monitor ${monitorId}`
        );
      } catch (scheduleError) {
        console.error(
          "[DELETE_MONITOR] Error unscheduling monitor (monitor still deleted):",
          scheduleError
        );
        // Continue with other cleanup even if unscheduling fails
      }

      // Log the audit event for monitor deletion
      await logAuditEvent({
        userId,
        action: "monitor_deleted",
        resource: "monitor",
        resourceId: monitorId,
        metadata: {
          organizationId,
          monitorName: transactionResult.monitorData?.name,
          monitorType: transactionResult.monitorData?.type,
          target: transactionResult.monitorData?.target,
          projectId: project.id,
          projectName: project.name,
          resultsDeleted: transactionResult.deletedResults,
          reportsDeleted: transactionResult.reportsToDelete?.length || 0,
        },
        success: true as const,
      }).catch((_auditError) => {
        console.error(
          "[DELETE_MONITOR] Error logging audit event (monitor still deleted):",
          _auditError
        );
      });

      // Revalidate paths
      try {
        console.log("[DELETE_MONITOR] Revalidating paths...");
        revalidatePath("/monitors");
        revalidatePath("/");
        console.log("[DELETE_MONITOR] Paths revalidated successfully");
      } catch (revalidateError) {
        console.error(
          "[DELETE_MONITOR] Error revalidating paths (monitor still deleted):",
          revalidateError
        );
      }

      console.log(
        `[DELETE_MONITOR] Successfully deleted monitor ${monitorId} with ${
          transactionResult.deletedResults
        } results and ${transactionResult.reportsToDelete?.length || 0} reports`
      );

      return {
        success: true as const,
        message: `Monitor "${
          transactionResult.monitorData?.name || "Unknown"
        }" has been deleted.`,
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
    console.error("[DELETE_MONITOR] Unexpected error:", {
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
