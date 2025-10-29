"use server";

import { db } from "@/utils/db";
import { statusPageComponents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

export async function deleteComponent(id: string, statusPageId: string) {
  console.log(`Deleting component ${id}`);

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
        `User ${userId} attempted to delete component without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to delete components",
      };
    }

    try {
      // Get component details before deletion for audit log
      const component = await db.query.statusPageComponents.findFirst({
        where: eq(statusPageComponents.id, id),
      });

      if (!component) {
        return {
          success: false,
          message: "Component not found",
        };
      }

      // Delete the component
      await db
        .delete(statusPageComponents)
        .where(eq(statusPageComponents.id, id));

      console.log(`Component ${id} deleted successfully by user ${userId}`);

      // Log the audit event
      await logAuditEvent({
        userId,
        action: "component_deleted",
        resource: "status_page_component",
        resourceId: id,
        metadata: {
          organizationId,
          componentName: component.name,
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
        message: "Component deleted successfully",
      };
    } catch (dbError) {
      console.error("Database error:", dbError);
      return {
        success: false,
        message: `Failed to delete component: ${
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
