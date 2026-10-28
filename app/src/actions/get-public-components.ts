"use server";

import { db } from "@/utils/db";
import {
  statusPageComponents,
  statusPages,
  statusPageComponentMonitors,
  monitorAggregates,
  monitorResults,
} from "@/db/schema";
import { eq, and, gte, lt, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { combineMonitorDay, type MonitorDayCounts } from "@/lib/status-page-uptime";
import { excludeSupersededSyntheticResults } from "@/lib/monitor-result-filters";

// UUID validation schema
const uuidSchema = z.string().uuid("Invalid status page ID format");

/**
 * Public action to get components for a status page without authentication
 * Only returns components for published status pages
 *
 * SECURITY NOTES:
 * - Only returns published page components
 * - Validates UUID format to prevent injection
 * - Only returns public-safe fields (no internal URLs, targets, or metadata)
 */
export async function getPublicComponents(statusPageId: string) {
  try {
    // Validate input
    if (!statusPageId) {
      return {
        success: false,
        message: "Status page ID is required",
        components: [],
      };
    }

    // Validate UUID format
    const validationResult = uuidSchema.safeParse(statusPageId);
    if (!validationResult.success) {
      return {
        success: false,
        message: "Invalid status page ID",
        components: [],
      };
    }

    // First verify that the status page exists and is published
    const statusPage = await db.query.statusPages.findFirst({
      where: and(
        eq(statusPages.id, statusPageId),
        eq(statusPages.status, "published"),
      ),
      columns: { id: true }, // Only need to verify existence
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found or not published",
        components: [],
      };
    }

    const components = await db.query.statusPageComponents.findMany({
      where: and(
        eq(statusPageComponents.statusPageId, statusPageId),
        eq(statusPageComponents.showcase, true),
      ),
      columns: {
        id: true,
        name: true,
        description: true,
        status: true,
        showcase: true,
        onlyShowIfDegraded: true,
        position: true,
        startDate: true,
        aggregationMethod: true,
        failureThreshold: true,
        createdAt: true,
        updatedAt: true,
        // EXCLUDED: statusPageId (redundant), automationEmail (internal)
      },
      orderBy: (components, { asc }) => [
        asc(components.position),
        asc(components.createdAt),
      ],
    });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 89);
    const componentIds = components.map((component) => component.id);
    const combinedAggregate = alias(monitorAggregates, "combined_aggregate");
    const historical =
      componentIds.length === 0
        ? []
        : await db
            .select({
              componentId: statusPageComponentMonitors.componentId,
              monitorId: statusPageComponentMonitors.monitorId,
              weight: statusPageComponentMonitors.weight,
              date: sql<string>`to_char(${monitorAggregates.periodStart}, 'YYYY-MM-DD')`,
              totalChecks: sql<number>`sum(${monitorAggregates.totalChecks})::integer`,
              successfulChecks: sql<number>`sum(${monitorAggregates.successfulChecks})::integer`,
            })
            .from(statusPageComponentMonitors)
            .innerJoin(
              monitorAggregates,
              eq(
                monitorAggregates.monitorId,
                statusPageComponentMonitors.monitorId,
              ),
            )
            .where(
              and(
                inArray(statusPageComponentMonitors.componentId, componentIds),
                eq(monitorAggregates.periodType, "daily"),
                or(
                  isNull(monitorAggregates.location),
                  notExists(
                    db.select({ id: combinedAggregate.id })
                      .from(combinedAggregate)
                      .where(and(
                        eq(combinedAggregate.monitorId, monitorAggregates.monitorId),
                        eq(combinedAggregate.periodType, monitorAggregates.periodType),
                        eq(combinedAggregate.periodStart, monitorAggregates.periodStart),
                        isNull(combinedAggregate.location),
                      )),
                  ),
                ),
                gte(monitorAggregates.periodStart, from),
                lt(monitorAggregates.periodStart, today),
              ),
            )
            .groupBy(
              statusPageComponentMonitors.componentId,
              statusPageComponentMonitors.monitorId,
              statusPageComponentMonitors.weight,
              monitorAggregates.periodStart,
            );
    const current =
      componentIds.length === 0
        ? []
        : await db
            .select({
              componentId: statusPageComponentMonitors.componentId,
              monitorId: statusPageComponentMonitors.monitorId,
              weight: statusPageComponentMonitors.weight,
              date: sql<string>`to_char(${monitorResults.checkedAt}, 'YYYY-MM-DD')`,
              totalChecks: sql<number>`count(*)::integer`,
              successfulChecks: sql<number>`count(*) filter (where ${monitorResults.isUp})::integer`,
            })
            .from(statusPageComponentMonitors)
            .innerJoin(
              monitorResults,
              eq(
                monitorResults.monitorId,
                statusPageComponentMonitors.monitorId,
              ),
            )
            .where(
              and(
                inArray(statusPageComponentMonitors.componentId, componentIds),
                gte(monitorResults.checkedAt, today),
                excludeSupersededSyntheticResults,
              ),
            )
            .groupBy(
              statusPageComponentMonitors.componentId,
              statusPageComponentMonitors.monitorId,
              statusPageComponentMonitors.weight,
              sql`to_char(${monitorResults.checkedAt}, 'YYYY-MM-DD')`,
            );
    const dailyMetrics = [...historical, ...current];

    // Linked monitor names/ids/status are internal; only the aggregated metrics are public.
    const publicComponents = components.map(
      ({ aggregationMethod, failureThreshold, ...component }) => {
        const byDate = new Map<string, MonitorDayCounts[]>();
        for (const metric of dailyMetrics) {
          if (metric.componentId !== component.id) continue;
          const day = byDate.get(metric.date) ?? [];
          day.push(metric);
          byDate.set(metric.date, day);
        }
        return {
          ...component,
          dailyMetrics: [...byDate].map(([date, monitors]) => ({
            date,
            ...combineMonitorDay(monitors, aggregationMethod, failureThreshold),
          })),
        };
      },
    );

    return {
      success: true,
      components: publicComponents,
    };
  } catch (error) {
    console.error("Error fetching public components:", error);
    return {
      success: false,
      message: "Failed to fetch components",
      components: [],
    };
  }
}
