"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  statusPageSettingsFieldsSchema,
  updateStatusPageSettings as updateStatusPageSettingsService,
} from "@/lib/status-pages/service";

const updateSettingsSchema = statusPageSettingsFieldsSchema.extend({
  statusPageId: z.string().uuid("Invalid status page ID"),
});

type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

export async function updateStatusPageSettings(data: UpdateSettingsInput) {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Validate the page id here so an invalid id is reported before any lookups
    const idResult = updateSettingsSchema.shape.statusPageId.safeParse(data?.statusPageId);
    if (!idResult.success) {
      return {
        success: false,
        message: idResult.error.issues[0]?.message || "Invalid input data",
      };
    }
    const { statusPageId, ...settings } = data;

    const result = await updateStatusPageSettingsService(
      { userId, organizationId, projectId: project.id, projectName: project.name },
      idResult.data,
      settings
    );

    if (!result.ok) {
      return { success: false, message: result.message };
    }

    // Revalidate paths
    revalidatePath(`/status-pages/${idResult.data}`);
    revalidatePath(`/status-pages/${idResult.data}/public`);

    return {
      success: true,
      message: "Settings updated successfully",
    };
  } catch (error) {
    console.error("Error updating status page settings:", error);
    return {
      success: false,
      message: "Failed to update settings. Please try again.",
    };
  }
}

export async function resetBrandingToDefaults(statusPageId: string) {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Validate UUID format
    if (!z.string().uuid().safeParse(statusPageId).success) {
      return {
        success: false,
        message: "Invalid status page ID",
      };
    }

    // SECURITY: Verify ownership before updating
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to reset branding for status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    await db
      .update(statusPages)
      .set({
        cssBodyBackgroundColor: "#ffffff",
        cssFontColor: "#333333",
        cssLightFontColor: "#666666",
        cssGreens: "#2ecc71",
        cssYellows: "#f1c40f",
        cssOranges: "#e67e22",
        cssBlues: "#3498db",
        cssReds: "#e74c3c",
        cssBorderColor: "#ecf0f1",
        cssGraphColor: "#3498db",
        cssLinkColor: "#3498db",
        cssNoData: "#bdc3c7",
        // Reset logo and favicon fields
        faviconLogo: null,
        transactionalLogo: null,
        heroCover: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statusPages.id, statusPageId),
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, project.id)
        )
      );

    // Log audit event
    await logAuditEvent({
      userId,
      action: "status_page_branding_reset",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        projectId: project.id,
      },
      success: true,
    });

    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);

    return {
      success: true,
      message: "Branding reset to defaults",
    };
  } catch (error) {
    console.error("Error resetting branding:", error);
    return {
      success: false,
      message: "Failed to reset branding. Please try again.",
    };
  }
}
