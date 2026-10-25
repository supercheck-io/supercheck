"use server";

import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { z } from "zod";
import { setStatusPagePublished } from "@/lib/status-pages/service";

async function changePublishState(
  statusPageId: string,
  target: "published" | "draft" | "archived"
) {
  const publishing = target === "published";
  const verb = publishing ? "publish" : "unpublish";
  try {
    // Validate UUID format
    if (!z.string().uuid().safeParse(statusPageId).success) {
      return {
        success: false,
        message: "Invalid status page ID",
      };
    }

    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check permission
    try {
      await requirePermissions(
        {
          status_page: ["update"],
        },
        {
          organizationId,
          projectId: project.id,
        }
      );
    } catch (error) {
      console.warn(
        `User ${userId} attempted to ${verb} status page without permission:`,
        error
      );
      return {
        success: false,
        message: `Insufficient permissions to ${verb} status pages`,
      };
    }

    const result = await setStatusPagePublished(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      statusPageId,
      target
    );
    if (!result.ok) {
      return { success: false, message: result.message };
    }
    const updatedStatusPage = result.data.statusPage;

    // Revalidate the status page routes
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);
    revalidatePath("/status-pages");

    return {
      success: true,
      message: publishing
        ? "Status page published successfully"
        : "Status page unpublished successfully",
      statusPage: {
        id: updatedStatusPage.id,
        name: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        status: updatedStatusPage.status,
      },
    };
  } catch (error) {
    console.error(`Error ${verb}ing status page:`, error);
    return {
      success: false,
      message: `Failed to ${verb} status page. Please try again.`,
    };
  }
}

export async function publishStatusPage(statusPageId: string) {
  return changePublishState(statusPageId, "published");
}

export async function unpublishStatusPage(statusPageId: string, archive = false) {
  return changePublishState(statusPageId, archive === true ? "archived" : "draft");
}
