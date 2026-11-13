import { revalidatePath } from "next/cache";
import type { ProjectAuthContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { isUuid } from "@/lib/uuid";
import { requestJobDeletion } from "@/lib/deletion/request";

import { permissionDeniedResult } from "@/lib/deletion/org-state";
type JobDeletionResult = { success: boolean; message?: string; error?: string; details?: string };

/**
 * Deleting a job is two-phase: this marks it `deleting` (hidden, unscheduled, runs cancelled) and queues a purge;
 * the purge worker removes storage, reports, runs and finally the row. It never refuses because runs are active.
 */
export async function deleteJobWithContext(jobId: string, context: ProjectAuthContext): Promise<JobDeletionResult> {
  if (!jobId) return { success: false, error: "Job ID is required" };
  const { userId, project, organizationId, orgPendingDeletion } = context;
  if (!checkPermissionWithContext("job", "delete", { userId, organizationId, orgPendingDeletion, project })) {
    console.warn(`[DELETE_JOB] User ${userId} attempted to delete job ${jobId} without permission`);
    return await permissionDeniedResult(organizationId, "Insufficient permissions to delete jobs");
  }
  if (!isUuid(jobId)) return { success: false, error: "Job not found or access denied" };
  try {
    const result = await requestJobDeletion({ id: jobId, projectId: project.id, organizationId, userId });
    if (result.status === "not_found") return { success: false, error: "Job not found or access denied" };
    if (result.status === "requested") {
      await logAuditEvent({
        userId, action: "job_deleted", resource: "job", resourceId: jobId,
        metadata: { organizationId, jobName: result.data.name, jobDescription: result.data.description, cronSchedule: result.data.cronSchedule, projectId: project.id, projectName: project.name },
        success: true as const,
      }).catch((error) => console.error("[DELETE_JOB] Error logging audit event (deletion still queued):", error));
    }
    try { revalidatePath("/jobs"); revalidatePath("/runs"); revalidatePath("/"); } catch (error) { console.error("[DELETE_JOB] Error revalidating paths:", error); }
    return { success: true, message: "Job deleted. Its runs and reports are being removed in the background." };
  } catch (error) {
    console.error("[DELETE_JOB] Unexpected error:", error);
    return { success: false, error: "Could not delete. Please try again.", details: "Check server logs for more information" };
  }
}
