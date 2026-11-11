import { isDeepStrictEqual } from "node:util";
import { db } from "@/utils/db";
import { monitors, monitorResults, reports } from "@/db/schema";
import { eq, and, inArray, count, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { deleteScheduledMonitor } from "@/lib/monitor-scheduler";
import { createS3CleanupService } from "@/lib/s3-cleanup";
import { chunk, selectInChunks, DELETION_TX_LIMITS, DELETION_TX_STATEMENT_LIMIT } from "./chunks";
import { removeServiceResourceLinks, removeTrialSuspensions } from "./linked-records";

type MonitorDeletionResult = {
  success: boolean;
  message?: string;
  error?: string;
  details?: string;
};

const MAX_CLEANUP_ATTEMPTS = 5;

class ResultsChangedError extends Error {
  constructor(message = "Monitor results changed during cleanup; retry deletion") {
    super(message);
  }
}

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

      // An active monitor keeps producing results while storage cleanup runs, so repeat the cycle until a
      // pass finds nothing new: clean storage for results not yet cleaned, delete those rows in small
      // chunks (their storage is gone), then delete the monitor only when no result remains.
      const cleaned = new Set<string>(); // keyed by id and location, so a moved report is cleaned again
      const key = (...parts: Array<string | null>) => JSON.stringify(parts);
      const executionIds = new Set<string>();
      const urls = new Set<string>();
      for (let attempt = 1; ; attempt++) {
      const resultsWithReports = await tx
        .select({
          id: monitorResults.id,
          testExecutionId: monitorResults.testExecutionId,
          testReportS3Url: monitorResults.testReportS3Url,
        })
        .from(monitorResults)
        .where(eq(monitorResults.monitorId, monitorId));

      // Accumulated across attempts: result rows are deleted as they are cleaned, but their report rows must still be found.
      for (const result of resultsWithReports) {
        if (result.testExecutionId) executionIds.add(result.testExecutionId);
        if (result.testReportS3Url) urls.add(result.testReportS3Url);
      }
      // Match by the indexed (entity_type, entity_id) key; s3_url (unindexed) only finds legacy rows.
      const ownedReports = async (reader: Pick<typeof db, "select">, lock: boolean) => {
        const find = (column: typeof reports.entityId | typeof reports.s3Url) => (values: string[]) => {
          const query = reader.select({
            id: reports.id, entityId: reports.entityId, reportPath: reports.reportPath, s3Url: reports.s3Url,
          }).from(reports).where(and(eq(reports.entityType, "monitor"), inArray(column, values)));
          return lock ? query.for("update") : query;
        };
        const rows = new Map<string, Awaited<ReturnType<ReturnType<typeof find>>>[number]>();
        for (const row of [...await selectInChunks([...executionIds], find(reports.entityId)), ...await selectInChunks([...urls], find(reports.s3Url))]) rows.set(row.id, row);
        return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
      };
      const reportRows = await ownedReports(tx, false);

      // Filter results that have S3 reports
      const reportsToDelete = resultsWithReports.filter(
        (result) => result.testReportS3Url
      );
      const resultKey = (report: typeof resultsWithReports[number]) => key("r", report.id, report.testExecutionId, report.testReportS3Url);
      const pendingResults = reportsToDelete.filter(report => !cleaned.has(resultKey(report)));
      const pendingReports = reportRows.filter(report => !cleaned.has(key("p", report.id, report.reportPath, report.s3Url)));

      if (pendingResults.length > 0 || pendingReports.length > 0) {
        const cleanup = await createS3CleanupService().deleteReports(
          [...pendingResults.map(report => ({
            reportPath: report.testExecutionId || undefined,
            s3Url: report.testReportS3Url || undefined,
            entityId: report.id,
            entityType: "monitor" as const,
          })), ...pendingReports.map(report => ({
            reportPath: report.reportPath || undefined, s3Url: report.s3Url || undefined,
            entityId: report.entityId, entityType: "monitor" as const,
          }))]
        );
        if (!cleanup.success) throw new Error("Could not delete monitor storage; please retry");
        pendingResults.forEach(report => cleaned.add(resultKey(report)));
        pendingReports.forEach(report => cleaned.add(key("p", report.id, report.reportPath, report.s3Url)));
      }

      // Storage for these rows is gone, so deleting them in small statements (not one long transaction)
      // is safe and resumable: a failure here leaves only rows that are retried on the next attempt.
      let deletedResults = 0;
      for (const ids of chunk(resultsWithReports.map(result => result.id))) {
        deletedResults += (await tx.delete(monitorResults)
          .where(and(eq(monitorResults.monitorId, monitorId), inArray(monitorResults.id, ids)))
          .returning({ id: monitorResults.id })).length;
      }

      try {
      return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = ${DELETION_TX_LIMITS}`);
      await tx.execute(sql`SET LOCAL statement_timeout = ${DELETION_TX_STATEMENT_LIMIT}`);
      // The parent lock blocks new results (their foreign key needs a share lock on this row) until commit.
      const [freshMonitor] = await tx.select({id: monitors.id}).from(monitors).where(and(eq(monitors.id,monitorId),eq(monitors.projectId,project.id),eq(monitors.organizationId,organizationId))).for("update");
      if (!freshMonitor) throw new Error("Monitor not found or access denied");
      // Cheap guard: every collected result is deleted above, so any row left arrived during cleanup.
      const [{ remaining }] = await tx.select({ remaining: count() }).from(monitorResults).where(eq(monitorResults.monitorId, monitorId));
      if (remaining > 0) throw new ResultsChangedError();
      const freshReports = await ownedReports(tx, true);
      if (!isDeepStrictEqual(freshReports, reportRows)) {
        throw new ResultsChangedError("Monitor reports changed during cleanup; retry deletion");
      }
      for (const ids of chunk(reportRows.map(report => report.id))) await tx.delete(reports).where(inArray(reports.id, ids));

      await removeServiceResourceLinks(tx, "monitor", [monitorId]);
      await removeTrialSuspensions(tx, "monitor", [monitorId]);
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
        deletedResults,
      };
      });
      } catch (error) {
        if (!(error instanceof ResultsChangedError) || attempt >= MAX_CLEANUP_ATTEMPTS) throw error;
      }
      }
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
