/**
 * iCal Feed API for Status Pages
 *
 * Generates an iCalendar (.ics) feed for status page incidents.
 * Users can subscribe to this calendar in any calendar app
 * (Google Calendar, Apple Calendar, Outlook, etc.)
 *
 * Endpoint: GET /api/status-pages/[id]/ical
 */

import { db } from "@/utils/db";
import { statusPages, incidents } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const uuidSchema = z.string().uuid();

/**
 * Escape special characters for iCalendar text values
 * Per RFC 5545 section 3.3.11
 */
function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Format date to iCalendar UTC datetime format (YYYYMMDDTHHMMSSZ)
 */
function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Generate a deterministic UID for an incident event
 */
function generateUid(incidentId: string, domain: string): string {
  return `${incidentId}@${domain}`;
}

/**
 * Fold long lines per RFC 5545 (max 75 octets per line)
 * Uses byte length (TextEncoder) to correctly handle multibyte UTF-8 characters
 */
function foldLine(line: string): string {
  const maxBytes = 75;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(line);

  if (encoded.length <= maxBytes) return line;

  const parts: string[] = [];
  let offset = 0;

  // First line: up to 75 bytes
  let end = findUtf8SplitPoint(line, offset, maxBytes);
  parts.push(line.substring(offset, end));
  offset = end;

  // Continuation lines: space prefix counts as 1 byte, so 74 bytes of content
  while (offset < line.length) {
    end = findUtf8SplitPoint(line, offset, maxBytes - 1);
    parts.push(` ${line.substring(offset, end)}`);
    offset = end;
  }

  return parts.join("\r\n");
}

/**
 * Find the maximum character index from `start` such that the UTF-8 byte
 * length of line.substring(start, index) does not exceed `maxBytes`.
 */
function findUtf8SplitPoint(
  line: string,
  start: number,
  maxBytes: number
): number {
  const encoder = new TextEncoder();
  let lo = start;
  let hi = Math.min(start + maxBytes, line.length); // char count never exceeds byte count for ASCII+
  // Binary search for the largest `hi` that fits
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (mid > line.length) {
      hi = mid - 1;
      continue;
    }
    if (encoder.encode(line.substring(start, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  // Ensure we make progress (at least one character)
  return lo > start ? lo : Math.min(start + 1, line.length);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const statusPageId = (await params).id;

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid status page ID" },
        { status: 400 }
      );
    }

    // Fetch status page - only published pages with needed fields
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
      columns: {
        id: true,
        name: true,
        subdomain: true,
        status: true,
        allowRssFeed: true,
        pageDescription: true,
      },
    });

    if (!statusPage) {
      return NextResponse.json(
        { error: "Status page not found" },
        { status: 404 }
      );
    }

    // Check if RSS feed is enabled (reuse the same toggle for iCal)
    if (!statusPage.allowRssFeed) {
      return NextResponse.json(
        { error: "Calendar feed is disabled for this status page" },
        { status: 403 }
      );
    }

    // Fetch recent incidents (last 50)
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
    const domain = new URL(baseUrl).hostname;

    // Build iCalendar VEVENT entries
    const vevents = recentIncidents
      .map((incident) => {
        const incidentUrl = `${statusPageUrl}/incidents/${incident.id}`;
        const affectedComponents = incident.affectedComponents
          .map((ic) => ic.component?.name || "Unknown")
          .join(", ");

        const startDate = incident.createdAt || new Date();
        // Use resolvedAt as end date, or current time if still active
        const endDate = incident.resolvedAt || new Date();

        // Build description
        const descriptionParts: string[] = [];
        descriptionParts.push(`Impact: ${incident.impact}`);
        descriptionParts.push(`Status: ${incident.status}`);
        if (affectedComponents) {
          descriptionParts.push(`Affected Services: ${affectedComponents}`);
        }
        if (incident.body) {
          descriptionParts.push(`\n${incident.body}`);
        }
        descriptionParts.push(`\nDetails: ${incidentUrl}`);
        const description = descriptionParts.join("\n");

        const lines = [
          "BEGIN:VEVENT",
          foldLine(
            `UID:${generateUid(incident.id, domain)}`
          ),
          `DTSTART:${toICalDate(startDate)}`,
          `DTEND:${toICalDate(endDate)}`,
          `DTSTAMP:${toICalDate(new Date())}`,
          foldLine(
            `SUMMARY:${escapeIcalText(`[${incident.impact.toUpperCase()}] ${incident.name}`)}`
          ),
          foldLine(`DESCRIPTION:${escapeIcalText(description)}`),
          foldLine(`URL:${incidentUrl}`),
          `STATUS:${incident.status === "resolved" ? "CONFIRMED" : "TENTATIVE"}`,
          `CATEGORIES:${escapeIcalText(incident.impact)}`,
          "END:VEVENT",
        ];

        return lines.join("\r\n");
      })
      .join("\r\n");

    // Build complete iCalendar feed
    const icalFeed = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `PRODID:-//Supercheck//${escapeIcalText(statusPage.name)}//EN`,
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      foldLine(
        `X-WR-CALNAME:${escapeIcalText(statusPage.name)} - Status Updates`
      ),
      foldLine(
        `X-WR-CALDESC:${escapeIcalText(statusPage.pageDescription || `Incidents and maintenance for ${statusPage.name}`)}`
      ),
      "X-WR-TIMEZONE:UTC",
      vevents,
      "END:VCALENDAR",
    ].join("\r\n");

    return new NextResponse(icalFeed, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${statusPage.subdomain}-status.ics"`,
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[iCal Feed] Error generating feed:", error);
    return NextResponse.json(
      { error: "Failed to generate iCal feed" },
      { status: 500 }
    );
  }
}
