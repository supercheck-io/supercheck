"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateProxyUrl } from "@/lib/asset-proxy";

/**
 * Public action to get a status page by subdomain without authentication
 * Only returns published status pages
 *
 * This is used by the middleware-rewritten status page routes
 * where the subdomain is extracted from the hostname
 */
export async function getPublicStatusPageBySubdomain(subdomain: string) {
  try {
    // Validate input
    if (!subdomain) {
      return {
        success: false,
        message: "Status page subdomain is required",
      };
    }

    // Normalize subdomain (lowercase, trim)
    const normalizedSubdomain = subdomain.toLowerCase().trim();

    console.log("🔍 Looking up status page by subdomain:", {
      originalSubdomain: subdomain,
      normalizedSubdomain,
    });

    // Get the status page by subdomain - only if it's published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.subdomain, normalizedSubdomain),
        eq(statusPages.status, "published")
      ),
    });

    if (!statusPage) {
      console.log("❌ Status page not found or not published:", {
        subdomain: normalizedSubdomain,
      });
      return {
        success: false,
        message: "Status page not found or not published",
      };
    }

    console.log("✅ Status page found:", {
      id: statusPage.id,
      name: statusPage.name,
      subdomain: statusPage.subdomain,
    });

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
    console.error("Error fetching public status page by subdomain:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
      error,
    };
  }
}
