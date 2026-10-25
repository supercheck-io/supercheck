"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import {
  updateComponent as updateComponentService,
  updateComponentFieldsSchema,
} from "@/lib/status-pages/service";

const updateComponentSchema = updateComponentFieldsSchema.extend({
  id: z.string().uuid(),
  statusPageId: z.string().uuid(),
});

export type UpdateComponentData = z.infer<typeof updateComponentSchema>;

export async function updateComponent(data: UpdateComponentData) {
  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

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
        `[SECURITY] User ${userId} attempted to update component without permission`,
      );
      return {
        success: false,
        message: "Insufficient permissions to update components",
      };
    }

    const { id, statusPageId, ...fields } = data;

    const result = await updateComponentService(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      statusPageId,
      id,
      fields,
    );
    if (!result.ok) {
      return { success: false, message: result.message };
    }

    // Revalidate the status page
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);

    return {
      success: true,
      message: "Component updated successfully",
      component: result.data.component,
    };
  } catch (error) {
    console.error("Error updating component:", error);
    return {
      success: false,
      message: "Failed to update component. Please try again.",
    };
  }
}
