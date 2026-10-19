/**
 * RSS Feed API for Status Pages
 *
 * Generates an RSS 2.0 feed for status page incidents
 * Users can subscribe to this feed using any RSS reader
 *
 * Endpoint: GET /api/status-pages/[id]/rss
 */

import { getPublicStatusPageUrl } from "@/lib/domain-utils";
import { getEffectiveStatusPageDomain } from "@/lib/status-page-domain";
import { getLocaleForLanguage } from "@/lib/status-page-translations";
import { db } from "@/utils/db";
import { statusPages, incidents } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { normalizePublicStatusPageId } from "@/lib/public-status-page-id";

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format date to RFC 822 format (required for RSS)
 */
function toRFC822(date: Date): string {
  return date.toUTCString();
}

/**
 * Generate RSS feed for a status page
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const statusPageId = normalizePublicStatusPageId((await params).id);

    if (!statusPageId) {
      return NextResponse.json(
        { error: "Invalid status page ID" },
        { status: 400 }
      );
    }

    // Fetch published status page
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
    });

    if (!statusPage) {
      return NextResponse.json(
        { error: "Status page not found" },
        { status: 404 }
      );
    }

    // Check if RSS feed is enabled
    if (!statusPage.allowRssFeed) {
      return NextResponse.json(
        { error: "RSS feed is disabled for this status page" },
        { status: 403 }
      );
    }

    // Fetch recent incidents (last 30 days or 50 most recent)
    const recentIncidents = await db.query.incidents.findMany({
      where: eq(incidents.statusPageId, statusPageId),
      orderBy: desc(incidents.updatedAt),
      limit: 50,
      with: {
        updates: { where: (updates, { lte }) => lte(updates.displayAt, new Date()), orderBy: (updates, { desc }) => [desc(updates.createdAt)], limit: 50 },
        affectedComponents: {
          with: {
            component: {
              columns: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Base URL for links
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:3000";
    const statusPageUrl = getPublicStatusPageUrl({ subdomain: statusPage.subdomain, customDomain: statusPage.customDomain, customDomainVerified: statusPage.customDomainVerified, appUrl: baseUrl, statusPageDomain: getEffectiveStatusPageDomain() });
    const rssUrl = `${baseUrl}/api/status-pages/${statusPageId}/rss`;

    // Build RSS feed XML
    const entries = recentIncidents.flatMap((incident) => {
      const updates = incident.updates.length ? incident.updates : [{ id: incident.id, body: incident.body, status: incident.status, createdAt: incident.createdAt, displayAt: incident.createdAt }];
      return updates.map((update) => ({ incident, update }));
    }).sort((a, b) => (b.update.displayAt?.getTime() ?? 0) - (a.update.displayAt?.getTime() ?? 0)).slice(0, 50);
    const rssItems = entries.map(({ incident, update }) => {
      const incidentUrl = `${statusPageUrl}/incidents/${incident.id}`;
      const description = `<p><strong>Status:</strong> ${escapeXml(update.status)}</p><p><strong>Impact:</strong> ${escapeXml(incident.impact)}</p><div>${escapeXml(update.body || "")}</div>`;
      return `<item><title>${escapeXml(incident.name)}</title><link>${escapeXml(incidentUrl)}</link><guid isPermaLink="false">urn:supercheck:incident-update:${escapeXml(update.id)}</guid><pubDate>${toRFC822(update.displayAt || update.createdAt || new Date())}</pubDate><description><![CDATA[${description}]]></description><category>${escapeXml(incident.impact)}</category></item>`;
    }).join("\n");

    // Build complete RSS feed
    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(statusPage.name)} - Status Updates</title>
    <link>${escapeXml(statusPageUrl)}</link>
    <description>${escapeXml(statusPage.pageDescription || `Real-time status updates for ${statusPage.name}`)}</description>
    <language>${escapeXml(getLocaleForLanguage(statusPage.language))}</language>
    <lastBuildDate>${toRFC822(new Date())}</lastBuildDate>
    <atom:link href="${escapeXml(rssUrl)}" rel="self" type="application/rss+xml" />
    <generator>Supercheck Status Page</generator>
    <ttl>60</ttl>
${rssItems}
  </channel>
</rss>`;

    // Return RSS feed with appropriate headers
    return new NextResponse(rssFeed, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30", // Short shared-cache window; browsers always revalidate
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[RSS Feed] Error generating feed:", error);
    return NextResponse.json(
      { error: "Failed to generate RSS feed" },
      { status: 500 }
    );
  }
}
