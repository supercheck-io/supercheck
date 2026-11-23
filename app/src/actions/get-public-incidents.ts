"use server";

import { withOpenIntervals } from "@/lib/status-page-incident-intervals";
import { db } from "@/utils/db";
import { incidents, statusPages } from "@/db/schema";
import { eq, desc, and, or, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { PUBLIC_INCIDENT_COLUMNS, PUBLIC_UPDATE_COLUMNS, pickPublicIncident, toPublicUpdate } from "@/lib/status-pages/public-incident-dto";

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
      where: and(eq(incidents.statusPageId, statusPageId), or(ne(incidents.status, "resolved"), gte(incidents.createdAt, new Date(Date.now() - 90 * 86400000)), gte(incidents.resolvedAt, new Date(Date.now() - 90 * 86400000)))),
      limit: 500,
      columns: PUBLIC_INCIDENT_COLUMNS,
      orderBy: [desc(incidents.createdAt)],
      with: {
        // Eager load affected components
        affectedComponents: {
          with: {
            component: {
              columns: {
                id: true,
                name: true,
                showcase: true,
              },
            },
          },
        },
        // Eager load updates (only the latest)
        updates: {
          where: (updates, { lte }) => lte(updates.displayAt, new Date()),
          columns: PUBLIC_UPDATE_COLUMNS,
          orderBy: (updates, { desc }) => [desc(updates.displayAt)],
          limit: 1,
        },
      },
    });

    // Transform to expected format
    const incidentsWithDetails = incidentsList.map((incident) => ({
      ...pickPublicIncident(incident),
      affectedComponentsCount: incident.affectedComponents.filter((ic) => ic.component?.showcase).length,
      // newStatus: what the component showed during the incident, for the uptime bars.
      affectedComponents: incident.affectedComponents.flatMap((ic) => (ic.component?.showcase ? [{ id: ic.component.id, name: ic.component.name, newStatus: ic.newStatus }] : [])),
      latestUpdate: incident.updates[0] ? toPublicUpdate(incident.updates[0]) : null,
    }));

    return {
      success: true,
      // Open periods from the status history, so a reopened incident's resolved gap is not counted as downtime.
      incidents: await withOpenIntervals(incidentsWithDetails),
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
