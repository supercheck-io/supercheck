"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateProxyUrl } from "@/lib/asset-proxy";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Public action to get a status page by ID without authentication
 * Only returns published status pages
 *
 * SECURITY NOTES:
 * - Only returns published pages
 * - Validates UUID format to prevent injection
 * - Only returns public-safe fields (no sensitive data)
 */
export async function getPublicStatusPage(id: string) {
  try {
    // Validate UUID format to prevent injection attacks
    const validationResult = uuidSchema.safeParse(id);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
      };
    }

    // Get the status page - only if it's published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(eq(statusPages.id, id), eq(statusPages.status, "published")),
      columns: {
        // Only select public-safe fields - exclude sensitive data
        id: true,
        name: true,
        subdomain: true,
        status: true,
        pageDescription: true,
        headline: true,
        supportUrl: true,
        timezone: true,
        // Branding fields
        cssBodyBackgroundColor: true,
        cssFontColor: true,
        cssLightFontColor: true,
        cssGreens: true,
        cssYellows: true,
        cssOranges: true,
        cssBlues: true,
        cssReds: true,
        cssBorderColor: true,
        cssGraphColor: true,
        cssLinkColor: true,
        cssNoData: true,
        faviconLogo: true,
        transactionalLogo: true,
        heroCover: true,
        customDomain: true,
        customDomainVerified: true,
        // Subscriber settings (to determine what subscription options to show)
        allowPageSubscribers: true,
        allowEmailSubscribers: true,
        allowWebhookSubscribers: true,
        allowSlackSubscribers: true,
        allowRssFeed: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or not published",
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
    console.error("Error fetching public status page:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
    };
  }
}
