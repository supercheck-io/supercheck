import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { isUuid } from "@/lib/uuid";
import { requestMonitorDeletion } from "@/lib/deletion/request";

type MonitorDeletionResult = { success: boolean; message?: string; error?: string; details?: string };

/**
 * Deleting a monitor is two-phase: this marks it `deleting` (hidden, unscheduled, never checked again) and queues a
 * purge; the purge worker removes storage, reports and results in batches and finally the row. A retry continues.
 */
export async function deleteMonitorWithContext(monitorId: string, context: ProjectAuthContext): Promise<MonitorDeletionResult> {
  if (!monitorId) return { success: false, error: "Monitor ID is required" };
  const { userId, project, organizationId } = context;
  if (!checkPermissionWithContext("monitor", "delete", { userId, organizationId, project })) {
    console.warn(`[DELETE_MONITOR] User ${userId} attempted to delete monitor ${monitorId} without permission`);
    return { success: false, error: "Insufficient permissions to delete monitors" };
  }
  if (!isUuid(monitorId)) return { success: false, error: "Monitor not found or access denied" };
  try {
    const result = await requestMonitorDeletion({ id: monitorId, projectId: project.id, organizationId, userId });
    if (result.status === "not_found") return { success: false, error: "Monitor not found or access denied" };
    if (result.status === "requested") {
      await logAuditEvent({
        userId, action: "monitor_deleted", resource: "monitor", resourceId: monitorId,
        metadata: { organizationId, monitorName: result.data.name, monitorType: result.data.type, target: result.data.target, projectId: project.id, projectName: project.name },
        success: true as const,
      }).catch((error) => console.error("[DELETE_MONITOR] Error logging audit event (deletion still queued):", error));
    }
    try { revalidatePath("/monitors"); revalidatePath("/"); } catch (error) { console.error("[DELETE_MONITOR] Error revalidating paths:", error); }
    return { success: true, message: "Monitor deleted. Its history is being removed in the background." };
  } catch (error) {
    console.error("[DELETE_MONITOR] Unexpected error:", error);
    return { success: false, error: "Could not delete. Please try again.", details: "Check server logs for more information" };
  }
}
