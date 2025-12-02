"use server";

import { db } from "@/utils/db";
import { statusPageComponents, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid();

export async function deleteComponent(id: string, statusPageId: string) {
  try {
    // Validate UUID formats first
    const idResult = uuidSchema.safeParse(id);
    const statusPageIdResult = uuidSchema.safeParse(statusPageId);

    if (!idResult.success || !statusPageIdResult.success) {
      return {
        success: false,
        message: "Invalid ID format",
      };
    }

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
    } catch {
      console.warn(
        `[SECURITY] User ${userId} attempted to delete component without permission`
      );
      return {
        success: false,
        message: "Insufficient permissions to delete components",
      };
    }

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to delete component from status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Get component details and verify it belongs to this status page
    const component = await db.query.statusPageComponents.findFirst({
      where: and(
        eq(statusPageComponents.id, id),
        eq(statusPageComponents.statusPageId, statusPageId)
      ),
    });

    if (!component) {
      return {
        success: false,
        message: "Component not found or access denied",
      };
    }

    // Delete the component
    await db
      .delete(statusPageComponents)
      .where(
        and(
          eq(statusPageComponents.id, id),
          eq(statusPageComponents.statusPageId, statusPageId)
        )
      );

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
  } catch (error) {
    console.error("Error deleting component:", error);
    return {
      success: false,
      message: "Failed to delete component. Please try again.",
    };
  }
}
