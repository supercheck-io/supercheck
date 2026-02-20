/**
 * Status Badge API for Status Pages
 *
 * Generates an SVG badge showing the current system status.
 * Can be embedded on external websites, READMEs, etc.
 *
 * Endpoint: GET /api/status-pages/[id]/badge
 *
 * Query params:
 *   - style: "flat" (default) | "flat-square"
 *   - label: Custom left-side label text (default: "status")
 */

import { db } from "@/utils/db";
import {
  statusPages,
  statusPageComponents,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const uuidSchema = z.string().uuid();

type BadgeConfig = {
  label: string;
  message: string;
  color: string;
};

/**
 * Calculate text width approximation for SVG
 * Uses a rough character-width estimate (6.5px per char at 11px font)
 */
function estimateTextWidth(text: string): number {
  return text.length * 6.5 + 10;
}

/**
 * Generate flat-style SVG badge (shields.io compatible)
 */
function generateBadgeSvg(
  config: BadgeConfig,
  style: "flat" | "flat-square"
): string {
  const safeLabel = escapeXml(config.label);
  const safeMessage = escapeXml(config.message);
  const safeAriaLabel = escapeXml(`${config.label}: ${config.message}`);
  const labelWidth = estimateTextWidth(config.label);
  const messageWidth = estimateTextWidth(config.message);
  const totalWidth = labelWidth + messageWidth;
  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;
  const borderRadius = style === "flat" ? 3 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${safeAriaLabel}">
  <title>${safeAriaLabel}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="${borderRadius}" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${config.color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">${safeLabel}</text>
    <text x="${labelX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">${safeLabel}</text>
    <text aria-hidden="true" x="${messageX * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}">${safeMessage}</text>
    <text x="${messageX * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageWidth - 10) * 10}">${safeMessage}</text>
  </g>
</svg>`;
}

function sanitizeLabelInput(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Determine overall system status from component statuses
 */
function calculateOverallStatus(
  componentStatuses: string[]
): { message: string; color: string } {
  if (componentStatuses.length === 0) {
    return { message: "operational", color: "#2ecc71" };
  }

  const hasStatus = (status: string) =>
    componentStatuses.some((s) => s === status);

  if (hasStatus("major_outage")) {
    return { message: "major outage", color: "#e74c3c" };
  }
  if (hasStatus("partial_outage")) {
    return { message: "partial outage", color: "#e67e22" };
  }
  if (hasStatus("degraded_performance")) {
    return { message: "degraded", color: "#f1c40f" };
  }
  if (hasStatus("under_maintenance")) {
    return { message: "maintenance", color: "#3498db" };
  }

  return { message: "operational", color: "#2ecc71" };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const statusPageId = (await params).id;
    const searchParams = request.nextUrl.searchParams;
    const style =
      searchParams.get("style") === "flat-square" ? "flat-square" : "flat";
    const label = sanitizeLabelInput(
      (searchParams.get("label") || "status").slice(0, 64)
    ) || "status";

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return new NextResponse(
        generateBadgeSvg(
          { label, message: "invalid id", color: "#9f9f9f" },
          style
        ),
        {
          status: 400,
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-cache",
          },
        }
      );
    }

    // Fetch status page
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
      columns: {
        id: true,
        name: true,
        cssGreens: true,
        cssReds: true,
        cssOranges: true,
        cssYellows: true,
        cssBlues: true,
      },
    });

    if (!statusPage) {
      return new NextResponse(
        generateBadgeSvg(
          { label, message: "not found", color: "#9f9f9f" },
          style
        ),
        {
          status: 404,
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-cache",
          },
        }
      );
    }

    // Fetch components for this status page
    const pageComponents = await db
      .select({
        status: statusPageComponents.status,
      })
      .from(statusPageComponents)
      .where(eq(statusPageComponents.statusPageId, statusPageId));

    const componentStatuses = pageComponents.map((c) => c.status);
    const { message, color } = calculateOverallStatus(componentStatuses);

    // Use custom colors from the status page if available
    let badgeColor = color;
    if (message === "operational" && statusPage.cssGreens)
      badgeColor = statusPage.cssGreens;
    if (message === "major outage" && statusPage.cssReds)
      badgeColor = statusPage.cssReds;
    if (message === "partial outage" && statusPage.cssOranges)
      badgeColor = statusPage.cssOranges;
    if (message === "degraded" && statusPage.cssYellows)
      badgeColor = statusPage.cssYellows;
    if (message === "maintenance" && statusPage.cssBlues)
      badgeColor = statusPage.cssBlues;

    const svg = generateBadgeSvg(
      { label, message, color: badgeColor },
      style
    );

    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Badge] Error generating badge:", error);
    return new NextResponse(
      generateBadgeSvg(
        { label: "status", message: "error", color: "#9f9f9f" },
        "flat"
      ),
      {
        status: 500,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      }
    );
  }
}
