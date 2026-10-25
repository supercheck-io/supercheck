"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import {
  createComponent as createComponentService,
  createComponentFieldsSchema,
} from "@/lib/status-pages/service";

const createComponentSchema = createComponentFieldsSchema.extend({
  statusPageId: z.string().uuid(),
});

export type CreateComponentData = z.infer<typeof createComponentSchema>;

export async function createComponent(data: CreateComponentData) {
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
        `[SECURITY] User ${userId} attempted to create component without permission`,
      );
      return {
        success: false,
        message: "Insufficient permissions to create components",
      };
    }

    // Validate the page id; the remaining fields are validated by the service
    const idResult = z.string().uuid().safeParse(data?.statusPageId);
    if (!idResult.success) {
      return { success: false, message: "Invalid data provided" };
    }
    const { statusPageId, ...fields } = data;

    const result = await createComponentService(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      idResult.data,
      fields,
    );
    if (!result.ok) {
      return { success: false, message: result.message };
    }

    // Revalidate the status page
    revalidatePath(`/status-pages/${idResult.data}`);
    revalidatePath(`/status-pages/${idResult.data}/public`);

    return {
      success: true,
      message: "Component created successfully",
      component: result.data.component,
    };
  } catch (error) {
    console.error("Error creating component:", error);
    return {
      success: false,
      message: "Failed to create component. Please try again.",
    };
  }
}
