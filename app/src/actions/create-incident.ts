"use server";

import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { permissionDeniedResult } from "@/lib/deletion/org-state";
import {
  createStatusPageIncident,
  type CreateIncidentData,
} from "@/lib/status-page-incident-core";

export type { CreateIncidentData } from "@/lib/status-page-incident-core";

export async function createIncident(data: CreateIncidentData) {
  try {
    // Get current project context (includes auth verification)
    const context = await requireProjectContext();
    const { userId, project, organizationId } = context;

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
        `[SECURITY] User ${userId} attempted to create incident without permission`,
      );
      return await permissionDeniedResult(organizationId, "Insufficient permissions to create incidents");
    }

    return await createStatusPageIncident(context, data);
  } catch (error) {
    console.error("Error creating incident:", error);
    return {
      success: false,
      message: "Failed to create incident. Please try again.",
    };
  }
}
