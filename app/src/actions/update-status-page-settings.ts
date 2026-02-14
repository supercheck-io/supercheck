"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit-logger";

// Validation schema with strict input sanitization
const updateSettingsSchema = z.object({
  statusPageId: z.string().uuid("Invalid status page ID"),
  // General settings - sanitize text inputs
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name too long")
    .trim()
    .optional(),
  headline: z.string().max(255, "Headline too long").trim().optional(),
  pageDescription: z
    .string()
    .max(2000, "Description too long")
    .trim()
    .optional(),
  supportUrl: z
    .string()
    .url("Invalid URL format")
    .max(500)
    .optional()
    .or(z.literal("")),
  timezone: z.string().max(50).optional(),

  // Custom domain with strict validation
  customDomain: z
    .string()
    .max(255)
    .regex(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      "Invalid domain format"
    )
    .transform((val) => val?.toLowerCase().trim())
    .optional()
    .or(z.literal("")),

  // Subscriber settings
  allowPageSubscribers: z.boolean().optional(),
  allowEmailSubscribers: z.boolean().optional(),
  allowWebhookSubscribers: z.boolean().optional(),
  allowSlackSubscribers: z.boolean().optional(),
  allowIncidentSubscribers: z.boolean().optional(),
  allowRssFeed: z.boolean().optional(),

  // Branding colors (hex codes) - strict validation
  cssBodyBackgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssFontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssLightFontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssGreens: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssYellows: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssOranges: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssBlues: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssReds: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssBorderColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssGraphColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssLinkColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
  cssNoData: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color")
    .optional(),
});

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function updateStatusPageSettings(data: UpdateSettingsInput) {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Validate input
    const validatedData = updateSettingsSchema.parse(data);
    const { statusPageId, ...settings } = validatedData;

    // SECURITY: Verify status page belongs to this organization AND project
    // This prevents unauthorized access to other organizations' status pages
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update status page ${statusPageId} without ownership`
      );
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // If custom domain is being changed, reset verification status
    const updatePayload: Record<string, unknown> = {
      ...settings,
      updatedAt: new Date(),
    };

    if (
      settings.customDomain !== undefined &&
      settings.customDomain !== statusPage.customDomain
    ) {
      updatePayload.customDomainVerified = false;

      if (settings.customDomain) {
        const existingDomain = await db.query.statusPages.findFirst({
          where: and(
            eq(statusPages.customDomain, settings.customDomain),
            ne(statusPages.id, statusPageId)
          ),
          columns: { id: true },
        });

        if (existingDomain) {
          return {
            success: false,
            message: "This custom domain is already in use by another status page",
          };
        }
      }
    }

    // Update status page
    await db
      .update(statusPages)
      .set(updatePayload)
      .where(
        and(
          eq(statusPages.id, statusPageId),
          eq(statusPages.organizationId, organizationId)
        )
      );

    // Log audit event for security tracking
    await logAuditEvent({
      userId,
      action: "status_page_settings_updated",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        projectId: project.id,
        changedFields: Object.keys(settings),
      },
      success: true,
    });

    // Revalidate paths
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);

    return {
      success: true,
      message: "Settings updated successfully",
    };
  } catch (error) {
    console.error("Error updating status page settings:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return {
        success: false,
        message: "This custom domain is already in use by another status page",
      };
    }

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid input data",
      };
    }

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
          eq(statusPages.organizationId, organizationId)
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
