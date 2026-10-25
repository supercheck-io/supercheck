"use server";

import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";
import { deleteComponent as deleteComponentService } from "@/lib/status-pages/service";

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

    const result = await deleteComponentService(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      statusPageId,
      id
    );
    if (!result.ok) {
      return { success: false, message: result.message };
    }

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
