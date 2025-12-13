"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { generateProxyUrl } from "@/lib/asset-proxy";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Get a status page by ID (authenticated, for internal management)
 *
 * SECURITY:
 * - Requires authentication via requireProjectContext
 * - Requires read permission on status_page resource
 * - Verifies ownership (status page belongs to user's org AND project)
 */
export async function getStatusPage(id: string) {
  try {
    // Validate UUID format
    const validationResult = uuidSchema.safeParse(id);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
      };
    }

    // Get current project context (includes auth verification)
    const { organizationId, project } = await requireProjectContext();

    // Check RBAC permissions for reading status pages
    await requirePermissions(
      { status_page: ["view"] },
      { organizationId, projectId: project.id }
    );

    // SECURITY: Verify ownership - status page must belong to user's org AND project
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, id),
        eq(statusPages.organizationId, organizationId),
        eq(statusPages.projectId, project.id)
      ),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or access denied",
      };
    }

    // Generate proxy URLs for logo assets
    // This converts S3 keys stored in the database to proxy URLs
    const faviconUrl = generateProxyUrl(statusPage.faviconLogo);
    const logoUrl = generateProxyUrl(statusPage.transactionalLogo);
    const coverUrl = generateProxyUrl(statusPage.heroCover);

    return {
      success: true,
      statusPage: {
        ...statusPage,
        faviconLogo: faviconUrl,
        transactionalLogo: logoUrl,
        heroCover: coverUrl,
      },
    };
  } catch (error) {
    console.error("Error fetching status page:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
    };
  }
}
