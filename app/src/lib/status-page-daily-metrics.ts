import { db } from "@/utils/db";
import {
  statusPageComponentMonitors,
  monitorAggregates,
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
import { monitorAggregationService } from "@/lib/monitor-aggregation-service";

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
  // Today is not aggregated yet. Read it through the same check (cycle) counting as the aggregates, so a
  // 3-region monitor with one region down does not read 67% today and 100% on every earlier day.
  const links =
    componentIds.length === 0
      ? []
      : await db
          .select({
            componentId: statusPageComponentMonitors.componentId,
            monitorId: statusPageComponentMonitors.monitorId,
            weight: statusPageComponentMonitors.weight,
          })
          .from(statusPageComponentMonitors)
          .where(inArray(statusPageComponentMonitors.componentId, componentIds));
  const now = new Date();
  // Hourly windows: completed hours come from the aggregates, only the partial hours read raw rows.
  // Concurrency is bounded so one anonymous page view cannot fan out into dozens of parallel queries.
  const monitorIds = [...new Set(links.map((link) => link.monitorId))];
  const todayByMonitor = new Map<string, Awaited<ReturnType<typeof monitorAggregationService.getWindowMetrics>>>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, monitorIds.length) }, async () => {
      while (next < monitorIds.length) {
        const monitorId = monitorIds[next++];
        todayByMonitor.set(
          monitorId,
          await monitorAggregationService.getWindowMetrics(monitorId, "hourly", today, now, null),
        );
      }
    }),
  );
  const todayKey = today.toISOString().slice(0, 10);
  const current = links.flatMap((link) => {
    const metrics = todayByMonitor.get(link.monitorId);
    return metrics && metrics.totalChecks > 0
      ? [{ ...link, date: todayKey, totalChecks: metrics.totalChecks, successfulChecks: metrics.successfulChecks }]
      : [];
  });
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
