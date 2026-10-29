import { db } from "@/utils/db";
import {
  statusPageComponentMonitors,
  monitorAggregates,
  monitorResults,
} from "@/db/schema";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  combineMonitorDay,
  type MonitorDayCounts,
} from "@/lib/status-page-uptime";
import { excludeSupersededSyntheticResults } from "@/lib/monitor-result-filters";

type ComponentForMetrics = {
  id: string;
  aggregationMethod: string;
  failureThreshold: number;
};

/**
 * Adds 90 days of combined uptime to each component, shared by the public page and the in-app preview.
 * Linked monitor names/ids/status are internal; only the aggregated metrics are returned.
 */
export async function withDailyMetrics<T extends ComponentForMetrics>(
  components: T[],
) {
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
                  db
                    .select({ id: combinedAggregate.id })
                    .from(combinedAggregate)
                    .where(
                      and(
                        eq(
                          combinedAggregate.monitorId,
                          monitorAggregates.monitorId,
                        ),
                        eq(
                          combinedAggregate.periodType,
                          monitorAggregates.periodType,
                        ),
                        eq(
                          combinedAggregate.periodStart,
                          monitorAggregates.periodStart,
                        ),
                        isNull(combinedAggregate.location),
                      ),
                    ),
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
            eq(monitorResults.monitorId, statusPageComponentMonitors.monitorId),
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
  return publicComponents;
}
