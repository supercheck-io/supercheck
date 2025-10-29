"use server";

import { db } from "@/utils/db";
import { incidents, incidentUpdates } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function getIncidentDetail(incidentId: string) {
  try {
    // Get incident with all updates
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, incidentId),
      with: {
        updates: {
          orderBy: [desc(incidentUpdates.createdAt)],
        },
        statusPage: {
          columns: {
            id: true,
            name: true,
            headline: true,
            subdomain: true,
          },
        },
      },
    });

    if (!incident) {
      return {
        success: false,
        message: "Incident not found",
        incident: null,
      };
    }

    return {
      success: true,
      incident,
    };
  } catch (error) {
    console.error("Error fetching incident detail:", error);
    return {
      success: false,
      message: "Failed to fetch incident details",
      incident: null,
    };
  }
}
