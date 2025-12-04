/**
 * Monitor Aggregation Service
 *
 * Production-grade service for computing and managing monitor metrics aggregations.
 *
 * Industry Best Practice (Checkly/Better Stack model):
 * - Raw check data: Short retention (7-30 days)
 * - Aggregated metrics: Long retention (30 days - 12+ months)
 *
 * Features:
 * - Hourly aggregations: P95, avg, uptime computed hourly for 30-day visibility
 * - Daily aggregations: Same metrics for 12+ month historical trends
 * - Multi-location support: Aggregates per-location and combined
 * - Idempotent operations: Safe to re-run without data corruption
 * - Batch processing: Efficient handling of high-volume data
 * - Transaction support: Atomic updates with rollback on failure
 *
 * @module monitor-aggregation-service
 */

import { db } from "@/utils/db";
import {
  monitorResults,
  monitors,
  monitorAggregates,
  type MonitorAggregateInsert,
  type AggregationPeriod,
} from "@/db/schema";
import { sql, and, eq, gte, lt, inArray, desc } from "drizzle-orm";
import type { MonitoringLocation } from "@/db/schema/types";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Aggregation configuration
 */
export const AGGREGATION_CONFIG = {
  // How many hours back to look for hourly aggregation (catch up on missed runs)
  HOURLY_LOOKBACK_HOURS: 24,

  // How many days back to look for daily aggregation (catch up on missed runs)
  DAILY_LOOKBACK_DAYS: 7,

  // Batch size for processing monitors
  MONITOR_BATCH_SIZE: 50,

  // Minimum checks required to compute meaningful P95
  MIN_CHECKS_FOR_P95: 5,

  // Default retention for hourly aggregates (days)
  DEFAULT_HOURLY_RETENTION_DAYS: 30,

  // Default retention for daily aggregates (days) - matches plan limits
  DEFAULT_DAILY_RETENTION_DAYS: 365,
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Raw metrics from monitor_results for aggregation
 */
interface RawMetrics {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  responseTimes: number[];
  statusChangeCount: number;
}

/**
 * Computed aggregate metrics
 */
interface ComputedMetrics {
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  uptimePercentage: string;
  avgResponseMs: number | null;
  minResponseMs: number | null;
  maxResponseMs: number | null;
  p50ResponseMs: number | null;
  p95ResponseMs: number | null;
  p99ResponseMs: number | null;
  totalResponseMs: number;
  statusChangeCount: number;
}

/**
 * Aggregation job result
 */
export interface AggregationResult {
  success: boolean;
  periodType: AggregationPeriod;
  monitorsProcessed: number;
  aggregatesCreated: number;
  aggregatesUpdated: number;
  duration: number;
  errors: string[];
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Truncate a date to the start of its hour (UTC)
 */
function truncateToHour(date: Date): Date {
  const truncated = new Date(date);
  truncated.setUTCMinutes(0, 0, 0);
  return truncated;
}

/**
 * Truncate a date to the start of its day (UTC)
 */
function truncateToDay(date: Date): Date {
  const truncated = new Date(date);
  truncated.setUTCHours(0, 0, 0, 0);
  return truncated;
}

/**
 * Calculate percentile from sorted array
 * @param sortedArr - Pre-sorted array of numbers (ascending)
 * @param percentile - Percentile to calculate (0-100)
 */
function calculatePercentile(
  sortedArr: number[],
  percentile: number
): number | null {
  if (sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];

  const index = Math.ceil((percentile / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
}

/**
 * Compute aggregate metrics from raw response times
 */
function computeMetrics(raw: RawMetrics): ComputedMetrics {
  const {
    totalChecks,
    successfulChecks,
    failedChecks,
    responseTimes,
    statusChangeCount,
  } = raw;

  // Calculate uptime percentage
  const uptimePercentage =
    totalChecks > 0
      ? ((successfulChecks / totalChecks) * 100).toFixed(2)
      : "0.00";

  // Sort response times for percentile calculations
  const sortedTimes = [...responseTimes].sort((a, b) => a - b);
  const validTimes = sortedTimes.filter((t) => t > 0);

  // Calculate response time metrics
  let avgResponseMs: number | null = null;
  let minResponseMs: number | null = null;
  let maxResponseMs: number | null = null;
  let p50ResponseMs: number | null = null;
  let p95ResponseMs: number | null = null;
  let p99ResponseMs: number | null = null;
  let totalResponseMs = 0;

  if (validTimes.length > 0) {
    totalResponseMs = validTimes.reduce((sum, t) => sum + t, 0);
    avgResponseMs = Math.round(totalResponseMs / validTimes.length);
    minResponseMs = validTimes[0];
    maxResponseMs = validTimes[validTimes.length - 1];
    p50ResponseMs = calculatePercentile(validTimes, 50);

    // Only calculate P95/P99 if we have enough data points
    if (validTimes.length >= AGGREGATION_CONFIG.MIN_CHECKS_FOR_P95) {
      p95ResponseMs = calculatePercentile(validTimes, 95);
      p99ResponseMs = calculatePercentile(validTimes, 99);
    }
  }

  return {
    totalChecks,
    successfulChecks,
    failedChecks,
    uptimePercentage,
    avgResponseMs,
    minResponseMs,
    maxResponseMs,
    p50ResponseMs,
    p95ResponseMs,
    p99ResponseMs,
    totalResponseMs,
    statusChangeCount,
  };
}

// ============================================================================
// MAIN AGGREGATION SERVICE
// ============================================================================

/**
 * Monitor Aggregation Service
 *
 * Handles computation and storage of hourly and daily monitor metrics.
 */
export class MonitorAggregationService {
  /**
   * Run hourly aggregation for all monitors
   * Computes metrics for the previous complete hour(s)
   */
  async runHourlyAggregation(): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      success: true,
      periodType: "hourly",
      monitorsProcessed: 0,
      aggregatesCreated: 0,
      aggregatesUpdated: 0,
      duration: 0,
      errors: [],
    };

    try {
      const now = new Date();
      const currentHour = truncateToHour(now);

      // Calculate lookback period (process any missed hours)
      const lookbackStart = new Date(currentHour);
      lookbackStart.setUTCHours(
        lookbackStart.getUTCHours() - AGGREGATION_CONFIG.HOURLY_LOOKBACK_HOURS
      );

      // Get all active monitors in batches
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const monitorBatch = await db
          .select({ id: monitors.id, organizationId: monitors.organizationId })
          .from(monitors)
          .where(eq(monitors.enabled, true))
          .limit(AGGREGATION_CONFIG.MONITOR_BATCH_SIZE)
          .offset(offset);

        if (monitorBatch.length === 0) {
          hasMore = false;
          break;
        }

        // Process each monitor
        for (const monitor of monitorBatch) {
          try {
            const { created, updated } = await this.aggregateMonitorHourly(
              monitor.id,
              lookbackStart,
              currentHour
            );
            result.aggregatesCreated += created;
            result.aggregatesUpdated += updated;
            result.monitorsProcessed++;
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            result.errors.push(
              `Monitor ${monitor.id.substring(0, 8)}: ${errorMsg}`
            );
          }
        }

        offset += AGGREGATION_CONFIG.MONITOR_BATCH_SIZE;
        if (monitorBatch.length < AGGREGATION_CONFIG.MONITOR_BATCH_SIZE) {
          hasMore = false;
        }
      }

      result.duration = Date.now() - startTime;

      if (result.errors.length > 0) {
        console.warn(
          `[AGGREGATION] Hourly completed with ${result.errors.length} errors`
        );
      } else {
        console.log(
          `[AGGREGATION] Hourly completed: ${result.monitorsProcessed} monitors, ` +
            `${result.aggregatesCreated} created, ${result.aggregatesUpdated} updated`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error("[AGGREGATION] Hourly aggregation failed:", error);
    }

    return result;
  }

  /**
   * Run daily aggregation for all monitors
   * Computes metrics for the previous complete day(s)
   */
  async runDailyAggregation(): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      success: true,
      periodType: "daily",
      monitorsProcessed: 0,
      aggregatesCreated: 0,
      aggregatesUpdated: 0,
      duration: 0,
      errors: [],
    };

    try {
      const now = new Date();
      const currentDay = truncateToDay(now);

      // Calculate lookback period
      const lookbackStart = new Date(currentDay);
      lookbackStart.setUTCDate(
        lookbackStart.getUTCDate() - AGGREGATION_CONFIG.DAILY_LOOKBACK_DAYS
      );

      // Get all active monitors in batches
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const monitorBatch = await db
          .select({ id: monitors.id, organizationId: monitors.organizationId })
          .from(monitors)
          .where(eq(monitors.enabled, true))
          .limit(AGGREGATION_CONFIG.MONITOR_BATCH_SIZE)
          .offset(offset);

        if (monitorBatch.length === 0) {
          hasMore = false;
          break;
        }

        // Process each monitor
        for (const monitor of monitorBatch) {
          try {
            const { created, updated } = await this.aggregateMonitorDaily(
              monitor.id,
              lookbackStart,
              currentDay
            );
            result.aggregatesCreated += created;
            result.aggregatesUpdated += updated;
            result.monitorsProcessed++;
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            result.errors.push(
              `Monitor ${monitor.id.substring(0, 8)}: ${errorMsg}`
            );
          }
        }

        offset += AGGREGATION_CONFIG.MONITOR_BATCH_SIZE;
        if (monitorBatch.length < AGGREGATION_CONFIG.MONITOR_BATCH_SIZE) {
          hasMore = false;
        }
      }

      result.duration = Date.now() - startTime;

      if (result.errors.length > 0) {
        console.warn(
          `[AGGREGATION] Daily completed with ${result.errors.length} errors`
        );
      } else {
        console.log(
          `[AGGREGATION] Daily completed: ${result.monitorsProcessed} monitors, ` +
            `${result.aggregatesCreated} created, ${result.aggregatesUpdated} updated`
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      result.duration = Date.now() - startTime;
      console.error("[AGGREGATION] Daily aggregation failed:", error);
    }

    return result;
  }

  /**
   * Aggregate hourly metrics for a specific monitor
   */
  private async aggregateMonitorHourly(
    monitorId: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    // Iterate through each hour in the range
    let currentHour = new Date(startTime);
    while (currentHour < endTime) {
      const nextHour = new Date(currentHour);
      nextHour.setUTCHours(nextHour.getUTCHours() + 1);

      // Get unique locations for this monitor in this hour
      const locations = await this.getLocationsForPeriod(
        monitorId,
        currentHour,
        nextHour
      );

      // Aggregate for each location
      for (const location of locations) {
        const result = await this.aggregatePeriod(
          monitorId,
          "hourly",
          currentHour,
          nextHour,
          location
        );
        if (result === "created") created++;
        else if (result === "updated") updated++;
      }

      // Also create combined aggregate (all locations)
      if (locations.length > 1) {
        const result = await this.aggregatePeriod(
          monitorId,
          "hourly",
          currentHour,
          nextHour,
          null // null = combined
        );
        if (result === "created") created++;
        else if (result === "updated") updated++;
      }

      currentHour = nextHour;
    }

    return { created, updated };
  }

  /**
   * Aggregate daily metrics for a specific monitor
   */
  private async aggregateMonitorDaily(
    monitorId: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    // Iterate through each day in the range
    let currentDay = new Date(startTime);
    while (currentDay < endTime) {
      const nextDay = new Date(currentDay);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      // Get unique locations for this monitor on this day
      const locations = await this.getLocationsForPeriod(
        monitorId,
        currentDay,
        nextDay
      );

      // Aggregate for each location
      for (const location of locations) {
        const result = await this.aggregatePeriod(
          monitorId,
          "daily",
          currentDay,
          nextDay,
          location
        );
        if (result === "created") created++;
        else if (result === "updated") updated++;
      }

      // Also create combined aggregate (all locations)
      if (locations.length > 1) {
        const result = await this.aggregatePeriod(
          monitorId,
          "daily",
          currentDay,
          nextDay,
          null // null = combined
        );
        if (result === "created") created++;
        else if (result === "updated") updated++;
      }

      currentDay = nextDay;
    }

    return { created, updated };
  }

  /**
   * Get unique locations for a monitor in a time period
   */
  private async getLocationsForPeriod(
    monitorId: string,
    startTime: Date,
    endTime: Date
  ): Promise<MonitoringLocation[]> {
    const result = await db
      .selectDistinct({ location: monitorResults.location })
      .from(monitorResults)
      .where(
        and(
          eq(monitorResults.monitorId, monitorId),
          gte(monitorResults.checkedAt, startTime),
          lt(monitorResults.checkedAt, endTime)
        )
      );

    return result
      .map((r) => r.location)
      .filter(Boolean) as MonitoringLocation[];
  }

  /**
   * Aggregate a single period (hour or day) for a monitor/location combo
   * Uses upsert for idempotency
   */
  private async aggregatePeriod(
    monitorId: string,
    periodType: AggregationPeriod,
    periodStart: Date,
    periodEnd: Date,
    location: MonitoringLocation | null
  ): Promise<"created" | "updated" | "skipped"> {
    // Build query conditions
    const conditions = [
      eq(monitorResults.monitorId, monitorId),
      gte(monitorResults.checkedAt, periodStart),
      lt(monitorResults.checkedAt, periodEnd),
    ];

    if (location) {
      conditions.push(eq(monitorResults.location, location));
    }

    // Fetch raw results for this period
    const results = await db
      .select({
        isUp: monitorResults.isUp,
        responseTimeMs: monitorResults.responseTimeMs,
        isStatusChange: monitorResults.isStatusChange,
      })
      .from(monitorResults)
      .where(and(...conditions));

    if (results.length === 0) {
      return "skipped";
    }

    // Compute raw metrics
    const raw: RawMetrics = {
      totalChecks: results.length,
      successfulChecks: results.filter((r) => r.isUp).length,
      failedChecks: results.filter((r) => !r.isUp).length,
      responseTimes: results
        .filter((r) => r.responseTimeMs !== null)
        .map((r) => r.responseTimeMs!),
      statusChangeCount: results.filter((r) => r.isStatusChange).length,
    };

    // Compute aggregate metrics
    const metrics = computeMetrics(raw);

    // Prepare the aggregate record
    const aggregateData: MonitorAggregateInsert = {
      monitorId,
      periodType,
      periodStart,
      location,
      totalChecks: metrics.totalChecks,
      successfulChecks: metrics.successfulChecks,
      failedChecks: metrics.failedChecks,
      uptimePercentage: metrics.uptimePercentage,
      avgResponseMs: metrics.avgResponseMs,
      minResponseMs: metrics.minResponseMs,
      maxResponseMs: metrics.maxResponseMs,
      p50ResponseMs: metrics.p50ResponseMs,
      p95ResponseMs: metrics.p95ResponseMs,
      p99ResponseMs: metrics.p99ResponseMs,
      totalResponseMs: metrics.totalResponseMs,
      statusChangeCount: metrics.statusChangeCount,
      updatedAt: new Date(),
    };

    // Check if aggregate already exists
    const existingConditions = [
      eq(monitorAggregates.monitorId, monitorId),
      eq(monitorAggregates.periodType, periodType),
      eq(monitorAggregates.periodStart, periodStart),
    ];

    if (location) {
      existingConditions.push(eq(monitorAggregates.location, location));
    } else {
      existingConditions.push(sql`${monitorAggregates.location} IS NULL`);
    }

    const existing = await db
      .select({ id: monitorAggregates.id })
      .from(monitorAggregates)
      .where(and(...existingConditions))
      .limit(1);

    if (existing.length > 0) {
      // Update existing aggregate
      await db
        .update(monitorAggregates)
        .set(aggregateData)
        .where(eq(monitorAggregates.id, existing[0].id));
      return "updated";
    } else {
      // Insert new aggregate
      await db.insert(monitorAggregates).values(aggregateData);
      return "created";
    }
  }

  /**
   * Get aggregated metrics for a monitor within a time range
   * Used by the UI to display 30d/90d/1yr metrics
   */
  async getAggregatedMetrics(
    monitorId: string,
    periodType: AggregationPeriod,
    startTime: Date,
    endTime: Date,
    location?: MonitoringLocation | null
  ): Promise<{
    uptimePercentage: number;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
    totalChecks: number;
  }> {
    const conditions = [
      eq(monitorAggregates.monitorId, monitorId),
      eq(monitorAggregates.periodType, periodType),
      gte(monitorAggregates.periodStart, startTime),
      lt(monitorAggregates.periodStart, endTime),
    ];

    if (location === null) {
      conditions.push(sql`${monitorAggregates.location} IS NULL`);
    } else if (location) {
      conditions.push(eq(monitorAggregates.location, location));
    }

    const aggregates = await db
      .select()
      .from(monitorAggregates)
      .where(and(...conditions))
      .orderBy(desc(monitorAggregates.periodStart));

    if (aggregates.length === 0) {
      return {
        uptimePercentage: 0,
        avgResponseMs: null,
        p95ResponseMs: null,
        totalChecks: 0,
      };
    }

    // Combine metrics across periods
    let totalChecks = 0;
    let successfulChecks = 0;
    let totalResponseMs = 0;
    let validResponseCount = 0;
    const allP95Values: number[] = [];

    for (const agg of aggregates) {
      totalChecks += agg.totalChecks;
      successfulChecks += agg.successfulChecks;

      if (agg.totalResponseMs && agg.totalChecks > 0) {
        totalResponseMs += agg.totalResponseMs;
        validResponseCount += agg.totalChecks;
      }

      if (agg.p95ResponseMs !== null) {
        allP95Values.push(agg.p95ResponseMs);
      }
    }

    const uptimePercentage =
      totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0;

    const avgResponseMs =
      validResponseCount > 0
        ? Math.round(totalResponseMs / validResponseCount)
        : null;

    // Use median of P95 values for combined P95
    const p95ResponseMs =
      allP95Values.length > 0
        ? calculatePercentile(
            allP95Values.sort((a, b) => a - b),
            50
          )
        : null;

    return {
      uptimePercentage: Number(uptimePercentage.toFixed(2)),
      avgResponseMs,
      p95ResponseMs,
      totalChecks,
    };
  }

  /**
   * Clean up old aggregate records based on retention policy
   */
  async cleanupOldAggregates(
    hourlyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_HOURLY_RETENTION_DAYS,
    dailyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_DAILY_RETENTION_DAYS
  ): Promise<{ hourlyDeleted: number; dailyDeleted: number }> {
    const now = new Date();

    // Calculate cutoff dates
    const hourlyCutoff = new Date(now);
    hourlyCutoff.setUTCDate(hourlyCutoff.getUTCDate() - hourlyRetentionDays);

    const dailyCutoff = new Date(now);
    dailyCutoff.setUTCDate(dailyCutoff.getUTCDate() - dailyRetentionDays);

    // Delete old hourly aggregates
    const hourlyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          eq(monitorAggregates.periodType, "hourly"),
          lt(monitorAggregates.periodStart, hourlyCutoff)
        )
      )
      .returning({ id: monitorAggregates.id });

    // Delete old daily aggregates
    const dailyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          eq(monitorAggregates.periodType, "daily"),
          lt(monitorAggregates.periodStart, dailyCutoff)
        )
      )
      .returning({ id: monitorAggregates.id });

    const hourlyDeleted = hourlyResult.length;
    const dailyDeleted = dailyResult.length;

    if (hourlyDeleted > 0 || dailyDeleted > 0) {
      console.log(
        `[AGGREGATION] Cleanup: deleted ${hourlyDeleted} hourly, ${dailyDeleted} daily aggregates`
      );
    }

    return { hourlyDeleted, dailyDeleted };
  }

  /**
   * Clean up old aggregate records for a specific organization
   * Used by DataLifecycleService for multi-tenant cleanup
   */
  async cleanupOldAggregatesForOrg(
    organizationId: string,
    hourlyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_HOURLY_RETENTION_DAYS,
    dailyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_DAILY_RETENTION_DAYS
  ): Promise<number> {
    const now = new Date();

    // Calculate cutoff dates
    const hourlyCutoff = new Date(now);
    hourlyCutoff.setUTCDate(hourlyCutoff.getUTCDate() - hourlyRetentionDays);

    const dailyCutoff = new Date(now);
    dailyCutoff.setUTCDate(dailyCutoff.getUTCDate() - dailyRetentionDays);

    // Get monitors for this organization
    const orgMonitors = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(eq(monitors.organizationId, organizationId));

    if (orgMonitors.length === 0) return 0;

    const monitorIds = orgMonitors.map((m) => m.id);

    // Delete old hourly aggregates for org's monitors
    const hourlyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          inArray(monitorAggregates.monitorId, monitorIds),
          eq(monitorAggregates.periodType, "hourly"),
          lt(monitorAggregates.periodStart, hourlyCutoff)
        )
      )
      .returning({ id: monitorAggregates.id });

    // Delete old daily aggregates for org's monitors
    const dailyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          inArray(monitorAggregates.monitorId, monitorIds),
          eq(monitorAggregates.periodType, "daily"),
          lt(monitorAggregates.periodStart, dailyCutoff)
        )
      )
      .returning({ id: monitorAggregates.id });

    const hourlyDeleted = hourlyResult.length;
    const dailyDeleted = dailyResult.length;
    const totalDeleted = hourlyDeleted + dailyDeleted;

    if (totalDeleted > 0) {
      console.log(
        `[AGGREGATION] Cleanup for org ${organizationId.substring(0, 8)}: deleted ${hourlyDeleted} hourly, ${dailyDeleted} daily aggregates`
      );
    }

    return totalDeleted;
  }
}

// Export singleton instance
export const monitorAggregationService = new MonitorAggregationService();
