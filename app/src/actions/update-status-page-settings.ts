"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { revalidatePath } from "next/cache";

const updateSettingsSchema = z.object({
  statusPageId: z.string().uuid(),
  // General settings
  name: z.string().min(1).max(255).optional(),
  headline: z.string().max(255).optional(),
  pageDescription: z.string().optional(),
  supportUrl: z.string().url().optional().or(z.literal("")),
  timezone: z.string().optional(),

  // Custom domain
  customDomain: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, "Invalid domain format")
    .optional()
    .or(z.literal("")),

  // Subscriber settings
  allowPageSubscribers: z.boolean().optional(),
  allowEmailSubscribers: z.boolean().optional(),
  allowWebhookSubscribers: z.boolean().optional(),
  allowIncidentSubscribers: z.boolean().optional(),

  // Branding colors (hex codes)
  cssBodyBackgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssFontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssLightFontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssGreens: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssYellows: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssOranges: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssBlues: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssReds: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssBorderColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssGraphColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssLinkColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  cssNoData: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function updateStatusPageSettings(data: UpdateSettingsInput) {
  try {
    const { organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Validate input
    const validatedData = updateSettingsSchema.parse(data);
    const { statusPageId, ...settings } = validatedData;

    // Check if status page exists
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, statusPageId),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found",
      };
    }

    // Update status page
    await db
      .update(statusPages)
      .set({
        ...settings,
        updatedAt: new Date(),
      })
      .where(eq(statusPages.id, statusPageId));

    // Revalidate paths
    revalidatePath(`/status-pages/${statusPageId}`);
    revalidatePath(`/status-pages/${statusPageId}/public`);

    return {
      success: true,
      message: "Settings updated successfully",
    };
  } catch (error) {
    console.error("Error updating status page settings:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid input",
      };
    }

    return {
      success: false,
      message: "Failed to update settings",
    };
  }
}

export async function resetBrandingToDefaults(statusPageId: string) {
  try {
    const { organizationId, project } = await requireProjectContext();
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

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
      .where(eq(statusPages.id, statusPageId));

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
      message: "Failed to reset branding",
    };
  }
}
