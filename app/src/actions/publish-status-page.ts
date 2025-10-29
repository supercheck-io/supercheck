"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

export async function publishStatusPage(statusPageId: string) {
  try {
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
        `User ${userId} attempted to publish status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to publish status pages",
      };
    }

    // Update status page status to published
    const [updatedStatusPage] = await db
      .update(statusPages)
      .set({
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(statusPages.id, statusPageId))
      .returning();

    if (!updatedStatusPage) {
      return {
        success: false,
        message: "Status page not found",
      };
    }

    console.log(`Status page ${statusPageId} published by user ${userId}`);

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "status_page_published",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        statusPageName: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    // Revalidate the status page routes
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);
    revalidatePath("/status-pages");

    return {
      success: true,
      message: "Status page published successfully",
      statusPage: updatedStatusPage,
    };
  } catch (error) {
    console.error("Error publishing status page:", error);
    return {
      success: false,
      message: `Failed to publish status page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    };
  }
}

export async function unpublishStatusPage(statusPageId: string) {
  try {
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
        `User ${userId} attempted to unpublish status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to unpublish status pages",
      };
    }

    // Update status page status to draft
    const [updatedStatusPage] = await db
      .update(statusPages)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(statusPages.id, statusPageId))
      .returning();

    if (!updatedStatusPage) {
      return {
        success: false,
        message: "Status page not found",
      };
    }

    console.log(`Status page ${statusPageId} unpublished by user ${userId}`);

    // Log the audit event
    await logAuditEvent({
      userId,
      action: "status_page_unpublished",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        statusPageName: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    // Revalidate the status page routes
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);
    revalidatePath("/status-pages");

    return {
      success: true,
      message: "Status page unpublished successfully",
      statusPage: updatedStatusPage,
    };
  } catch (error) {
    console.error("Error unpublishing status page:", error);
    return {
      success: false,
      message: `Failed to unpublish status page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    };
  }
}
