"use server";

import { db } from "@/utils/db";
import { incidents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

export async function deleteIncident(id: string, statusPageId: string) {
  console.log(`Deleting incident ${id}`);

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check status page management permission
    try {
      await requirePermissions(
        {
          status_page: ["delete"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch (error) {
      console.warn(
        `User ${userId} attempted to delete incident without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to delete incidents",
      };
    }

    try {
      // Get incident details before deletion for audit log
      const incident = await db.query.incidents.findFirst({
        where: eq(incidents.id, id),
      });

      if (!incident) {
        return {
          success: false,
          message: "Incident not found",
        };
      }

      // Delete the incident (cascade will handle related records)
      await db.delete(incidents).where(eq(incidents.id, id));

      console.log(`Incident ${id} deleted successfully by user ${userId}`);

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "incident_deleted",
        resource: "incident",
        resourceId: id,
        metadata: {
          organizationId,
          incidentName: incident.name,
          statusPageId,
          projectId: project.id,
          projectName: project.name,
        },
        success: true,
      });

      // Revalidate the status page
      revalidatePath(`/status-pages/${statusPageId}`);
      revalidatePath(`/status-pages/${statusPageId}/public`);

      return {
        success: true,
        message: "Incident deleted successfully",
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to delete incident: ${
          dbError instanceof Error ? dbError.message : String(dbError)
        }`,
        error: dbError,
      };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      success: false,
      message: "An error occurred",
      error,
    };
  }
}
