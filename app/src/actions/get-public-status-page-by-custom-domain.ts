"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateProxyUrl } from "@/lib/asset-proxy";

/**
 * Public action to get a status page by custom domain without authentication
 * Only returns published status pages with verified custom domains
 *
 * SECURITY NOTES:
 * - Only returns published pages
 * - Only returns pages with verified custom domains
 * - Only returns public-safe fields (no sensitive data)
 *
 * This is used by the custom domain routing from proxy.ts
 * where the hostname is extracted from the request
 */
export async function getPublicStatusPageByCustomDomain(hostname: string) {
  try {
    // Validate input
    if (!hostname) {
      return {
        success: false,
        message: "Custom domain hostname is required",
      };
    }

    // Normalize hostname (lowercase, trim)
    const normalizedHostname = hostname.toLowerCase().trim();

    // Get the status page by custom domain - only if published AND verified
    // SECURITY: Only select public-safe fields - exclude sensitive data
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.customDomain, normalizedHostname),
        eq(statusPages.customDomainVerified, true),
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
        // Subscriber settings
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
        message: "Status page not found or custom domain not verified",
      };
    }

    // Generate proxy URLs for logo assets
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
    console.error("Error fetching public status page by custom domain:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
    };
  }
}
