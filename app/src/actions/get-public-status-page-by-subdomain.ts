"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateProxyUrl } from "@/lib/asset-proxy";
import { z } from "zod";

// Subdomain validation: alphanumeric with hyphens, 3-63 chars, no leading/trailing hyphens
const subdomainSchema = z
  .string()
  .min(3, "Subdomain must be at least 3 characters")
  .max(63, "Subdomain must be at most 63 characters")
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i,
    "Invalid subdomain format"
  );

/**
 * Public action to get a status page by subdomain without authentication
 * Only returns published status pages
 *
 * SECURITY NOTES:
 * - Only returns published pages
 * - Validates subdomain format to prevent injection
 * - Only returns public-safe fields (no sensitive data)
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

    // Validate subdomain format
    const validationResult = subdomainSchema.safeParse(normalizedSubdomain);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid subdomain format",
      };
    }

    // Get the status page by subdomain - only if it's published
    // SECURITY: Only select public-safe fields - exclude sensitive data
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.subdomain, normalizedSubdomain),
        eq(statusPages.status, "published")
      ),
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
        // EXCLUDED: organizationId, projectId, createdByUserId, notification settings
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
    console.error("Error fetching public status page by subdomain:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
    };
  }
}
