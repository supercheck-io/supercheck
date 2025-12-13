"use server";

import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Public action to get incidents for a status page without authentication
 * Only returns incidents for published status pages
 *
 * SECURITY NOTES:
 * - Only returns published page incidents
 * - Validates UUID format to prevent injection
 * - Only returns public-safe fields (no createdByUserId, deliverNotifications, etc.)
 */
export async function getPublicIncidents(statusPageId: string) {
  try {
    // Validate input
    if (!statusPageId) {
      return {
        success: false,
        message: "Status page ID is required",
        incidents: [],
      };
    }

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
        incidents: [],
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
        incidents: [],
      };
    }

    // PERFORMANCE FIX: Use Drizzle eager loading instead of N+1 queries
    // Previously: fetched components and updates individually per incident in a loop
    // SECURITY: Only select public-safe fields
    const incidentsList = await db.query.incidents.findMany({
      where: eq(incidents.statusPageId, statusPageId),
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
      orderBy: [desc(incidents.createdAt)],
      with: {
        // Eager load affected components
        affectedComponents: {
          with: {
            component: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        },
        // Eager load updates (only the latest)
        updates: {
          columns: {
            id: true,
            body: true,
            status: true,
            displayAt: true,
            createdAt: true,
            // EXCLUDED: incidentId (redundant), createdByUserId, deliverNotifications
          },
          orderBy: (updates, { desc }) => [desc(updates.createdAt)],
          limit: 1,
        },
      },
    });

    // Transform to expected format
    const incidentsWithDetails = incidentsList.map((incident) => ({
      ...incident,
      affectedComponentsCount: incident.affectedComponents.length,
      affectedComponents: incident.affectedComponents.map((ic) => ic.component),
      latestUpdate: incident.updates[0] || null,
    }));

    return {
      success: true,
      incidents: incidentsWithDetails,
    };
  } catch (error) {
    console.error("Error fetching public incidents:", error);
    return {
      success: false,
      message: "Failed to fetch incidents",
      incidents: [],
    };
  }
}
