"use server";

import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { updateStatusPageIncident } from "@/lib/status-page-incident-core";
import type { UpdateIncidentStatusData } from "@/lib/validations/incident-status";

import { permissionDeniedResult } from "@/lib/deletion/org-state";
export type { UpdateIncidentStatusData } from "@/lib/validations/incident-status";

export async function updateIncidentStatus(
  data: UpdateIncidentStatusData,
  // Set by callers that decided from a possibly stale read: see updateStatusPageIncident.
  options?: { expectedStatus?: string },
) {
  try {
    // Get current project context (includes auth verification)
    const context = await requireProjectContext();
    const { userId, organizationId, project } = context;

    // Check status page management permission
    try {
      await requirePermissions(
        {
          status_page: ["update"],
        },
        {
          organizationId,
          projectId: project.id,
        },
      );
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to update incident without permission`,
      );
      return await permissionDeniedResult(organizationId, "Insufficient permissions to update incidents");
    }

    return await updateStatusPageIncident(context, data, options);
  } catch (error) {
    console.error("Error updating incident status:", error);
    return {
      success: false,
      message: "Failed to update incident. Please try again.",
    };
  }
}
