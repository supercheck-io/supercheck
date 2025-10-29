"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateProxyUrl } from "@/lib/asset-proxy";

/**
 * Public action to get a status page by ID without authentication
 * Only returns published status pages
 */
export async function getPublicStatusPage(id: string) {
  try {
    // Validate input
    if (!id) {
      return {
        success: false,
        message: "Status page ID is required",
      };
    }

    // Get the status page - only if it's published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, id),
        eq(statusPages.status, "published")
      ),
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
      error,
    };
  }
}
