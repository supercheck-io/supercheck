"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { z } from "zod";

export async function publishStatusPage(statusPageId: string) {
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
        `User ${userId} attempted to publish status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to publish status pages",
      };
    }

    // SECURITY: Verify ownership - status page must belong to this organization AND project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to publish status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Update status page status to published
    const [updatedStatusPage] = await db
      .update(statusPages)
      .set({
        status: "published",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statusPages.id, statusPageId),
          eq(statusPages.organizationId, organizationId)
        )
      )
      .returning();

    if (!updatedStatusPage) {
      return {
        success: false,
        message: "Failed to publish status page",
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
      statusPage: {
        id: updatedStatusPage.id,
        name: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        status: updatedStatusPage.status,
      },
    };
  } catch (error) {
    console.error("Error publishing status page:", error);
    return {
      success: false,
      message: "Failed to publish status page. Please try again.",
    };
  }
}

export async function unpublishStatusPage(statusPageId: string) {
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
        `User ${userId} attempted to unpublish status page without permission:`,
        error
      );
      return {
        success: false,
        message: "Insufficient permissions to unpublish status pages",
      };
    }

    // SECURITY: Verify ownership
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to unpublish status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Update status page status to draft
    const [updatedStatusPage] = await db
      .update(statusPages)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statusPages.id, statusPageId),
          eq(statusPages.organizationId, organizationId)
        )
      )
      .returning();

    if (!updatedStatusPage) {
      return {
        success: false,
        message: "Failed to unpublish status page",
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
      statusPage: {
        id: updatedStatusPage.id,
        name: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        status: updatedStatusPage.status,
      },
    };
  } catch (error) {
    console.error("Error unpublishing status page:", error);
    return {
      success: false,
      message: "Failed to unpublish status page. Please try again.",
    };
  }
}
