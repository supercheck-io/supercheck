/**
 * RSS Feed API for Status Pages
 *
 * Generates an RSS 2.0 feed for status page incidents
 * Users can subscribe to this feed using any RSS reader
 *
 * Endpoint: GET /api/status-pages/[id]/rss
 */

import { db } from "@/utils/db";
import { statusPages, incidents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

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
    const statusPageId = (await params).id;

    // Fetch status page
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, statusPageId),
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

    // Only published status pages should have public RSS feeds
    if (statusPage.status !== "published") {
      return NextResponse.json(
        { error: "Status page is not published" },
        { status: 404 }
      );
    }

    // Fetch recent incidents (last 30 days or 50 most recent)
    const recentIncidents = await db.query.incidents.findMany({
      where: eq(incidents.statusPageId, statusPageId),
      orderBy: desc(incidents.createdAt),
      limit: 50,
      with: {
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
    const statusPageUrl = `${baseUrl}/status/${statusPageId}`;
    const rssUrl = `${baseUrl}/api/status-pages/${statusPageId}/rss`;

    // Build RSS feed XML
    const rssItems = recentIncidents.map((incident) => {
      // FIX: Use actual incident detail route instead of anchor
      const incidentUrl = `${statusPageUrl}/incidents/${incident.id}`;
      const affectedComponents = incident.affectedComponents
        .map((ic) => ic.component?.name || "Unknown")
        .join(", ");

      // Create description with incident details
      const description = `
<![CDATA[
<p><strong>Status:</strong> ${escapeXml(incident.status)}</p>
<p><strong>Impact:</strong> ${escapeXml(incident.impact)}</p>
${affectedComponents ? `<p><strong>Affected Services:</strong> ${escapeXml(affectedComponents)}</p>` : ""}
${incident.body ? `<div><strong>Description:</strong><br/>${escapeXml(incident.body)}</div>` : ""}
]]>
      `.trim();

      return `
    <item>
      <title>${escapeXml(incident.name)}</title>
      <link>${escapeXml(incidentUrl)}</link>
      <guid isPermaLink="true">${escapeXml(incidentUrl)}</guid>
      <pubDate>${toRFC822(incident.createdAt || new Date())}</pubDate>
      <description>${description}</description>
      <category>${escapeXml(incident.impact)}</category>
      ${affectedComponents ? `<category>${escapeXml(affectedComponents)}</category>` : ""}
    </item>`;
    }).join("\n");

    // Build complete RSS feed
    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(statusPage.name)} - Status Updates</title>
    <link>${escapeXml(statusPageUrl)}</link>
    <description>${escapeXml(statusPage.pageDescription || `Real-time status updates for ${statusPage.name}`)}</description>
    <language>en-us</language>
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
        "Cache-Control": "public, max-age=300, s-maxage=300", // Cache for 5 minutes
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[RSS Feed] Error generating feed:", error);
    return NextResponse.json(
      {
        error: "Failed to generate RSS feed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
