"use server";

import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import {
  createStatusPage as createStatusPageService,
  type CreateStatusPageInput,
} from "@/lib/status-pages/service";

export type CreateStatusPageData = CreateStatusPageInput;

export async function createStatusPage(data: CreateStatusPageData) {
  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check status page creation permission using Better Auth
    try {
      await requirePermissions(
        {
          status_page: ["create"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch (error) {
      console.warn(
        `User ${userId} attempted to create status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to create status pages",
      };
    }

    const result = await createStatusPageService(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      data
    );

    if (!result.ok) {
      return { success: false, message: result.message };
    }
    const statusPage = result.data.statusPage;

    // Revalidate the status pages page
    revalidatePath("/status-pages");

    return {
      success: true,
      message: "Status page created successfully",
      statusPage: {
        id: statusPage.id,
        name: statusPage.name,
        headline: statusPage.headline,
        pageDescription: statusPage.pageDescription,
        subdomain: statusPage.subdomain,
        status: statusPage.status,
        createdAt: statusPage.createdAt,
        updatedAt: statusPage.updatedAt,
        createdByUserId: userId,
      },
    };
  } catch (error) {
    console.error("Error creating status page:", error);
    return {
      success: false,
      message: "Invalid data provided",
      error,
    };
  }
}
