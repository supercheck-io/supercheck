"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

export async function deleteStatusPage(id: string) {
  console.log(`Deleting status page: ${id}`);

  try {
    // Get current project context (includes auth verification)
    const { userId, project, organizationId } = await requireProjectContext();

    // Check delete permission using Better Auth
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
        `User ${userId} attempted to delete status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to delete status pages",
      };
    }

    // Fetch the status page to verify ownership and get details for audit log
    const [statusPage] = await db
      .select()
      .from(statusPages)
      .where(
        and(
          eq(statusPages.id, id),
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, project.id)
        )
      )
      .limit(1);

    if (!statusPage) {
      console.warn(`Status page ${id} not found or access denied`);
      return {
        success: false,
        message:
          "Status page not found or you don't have permission to delete it",
      };
    }

    // Delete the status page (cascade will handle related records)
    await db
      .delete(statusPages)
      .where(
        and(
          eq(statusPages.id, id),
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, project.id)
        )
      );

    console.log(`Status page ${id} deleted successfully by user ${userId}`);

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "status_page_deleted",
      resource: "status_page",
      resourceId: id,
      metadata: {
        organizationId,
        statusPageName: statusPage.name,
        projectId: project.id,
        projectName: project.name,
        subdomain: statusPage.subdomain,
      },
      success: true,
    });

    // Revalidate the status pages page
    revalidatePath("/status-pages");

    return {
      success: true,
      message: "Status page deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting status page:", error);
    return {
      success: false,
      message: `Failed to delete status page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    };
  }
}
