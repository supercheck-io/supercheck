"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid ID format");

/**
 * Public action to get incident details without authentication
 * Only returns incidents for published status pages
 *
 * SECURITY NOTES:
 * - Only returns published page incidents
 * - Validates UUID format to prevent injection
 * - Only returns public-safe fields (no createdByUserId, deliverNotifications, etc.)
 */
export async function getPublicIncidentDetail(
  incidentId: string,
  statusPageId: string
) {
  try {
    // Validate inputs
    if (!incidentId || !statusPageId) {
      return {
        success: false,
        message: "Incident ID and Status Page ID are required",
      };
    }

    // Validate UUID format
    if (
      !uuidSchema.safeParse(incidentId).success ||
      !uuidSchema.safeParse(statusPageId).success
    ) {
      return {
        success: false,
        message: "Invalid ID format",
      };
    }

    // First verify that the status page exists and is published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published")
      ),
      columns: { id: true },
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or not published",
      };
    }

    // Get the incident with explicit column selection
    // SECURITY: Only select public-safe fields
    const incident = await db.query.incidents.findFirst({
      where: and(
        eq(incidents.id, incidentId),
        eq(incidents.statusPageId, statusPageId)
      ),
      columns: {
        id: true,
        name: true,
        status: true,
        impact: true,
        impactOverride: true,
        body: true,
        scheduledFor: true,
        scheduledUntil: true,
        shortlink: true,
        monitoringAt: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        // EXCLUDED: statusPageId (redundant), createdByUserId, deliverNotifications,
        // backfillDate, backfilled, metadata, reminder/auto-transition settings
      },
    });

    if (!incident) {
      return {
        success: false,
        message: "Incident not found",
      };
    }

    // Get affected components
    const affectedComponents = await db.query.incidentComponents.findMany({
      where: (incidentComponents, { eq }) =>
        eq(incidentComponents.incidentId, incidentId),
      with: {
        component: {
          columns: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    // Get all updates with explicit column selection
    const updates = await db.query.incidentUpdates.findMany({
      where: (incidentUpdates, { eq }) =>
        eq(incidentUpdates.incidentId, incidentId),
      columns: {
        id: true,
        body: true,
        status: true,
        displayAt: true,
        createdAt: true,
        // EXCLUDED: incidentId (redundant), createdByUserId, deliverNotifications
      },
      orderBy: (incidentUpdates, { desc }) => [desc(incidentUpdates.createdAt)],
    });

    return {
      success: true,
      incident: {
        ...incident,
        affectedComponents: affectedComponents.map((ic) => ic.component),
        updates,
      },
    };
  } catch (error) {
    console.error("Error fetching public incident detail:", error);
    return {
      success: false,
      message: "Failed to fetch incident details",
    };
  }
}
