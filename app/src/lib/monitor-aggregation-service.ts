/**
 * Monitor Aggregation Service
 *
 * Production-grade service for computing and managing monitor metrics aggregations.
 *
 * Industry Best Practice (Checkly/Better Stack model):
 * - Raw check data: Short retention (7-30 days)
 * - Aggregated metrics: Long retention (30 days - 12+ months)
 *
 * Uptime definition: one CHECK (cycle) counts once. Rows that share an execution_group_id are one
 * cycle, judged up or down by the monitor's own region rule (strategy/threshold), the same decision as the
 * monitor status. Single-region monitors and rows without a group count once per row. The combined
 * (location = null) aggregate row holds these cycle counts; per-location rows count regional checks.
 * Response times are up checks only (> 0 ms) everywhere.
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
  monitorCycles,
  monitorAggregates,
  type MonitorAggregateInsert,
  type AggregationPeriod,
} from "@/db/schema";
import { sql, and, eq, gte, lt, lte, or, inArray, desc, type SQL } from "drizzle-orm";
import type { MonitoringLocation } from "@/db/schema/types";
import { excludeSupersededSyntheticResults } from "@/lib/monitor-result-filters";
import { monitorCyclePolicy } from "@/lib/monitor-cycles";

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
  /** Response times of up checks only. */
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
  responseSampleCount: number;
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
export function calculatePercentile(
  sortedArr: number[],
  percentile: number,
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
  const responseSampleCount = validTimes.length;

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
    responseSampleCount,
    statusChangeCount,
  };
}

// ============================================================================
// CHECK (CYCLE) HELPERS
// ============================================================================

const HOUR_MS = 3_600_000;
const PERIOD_MS: Record<AggregationPeriod, number> = {
  hourly: HOUR_MS,
  daily: 86_400_000,
};
/** Regions of one cycle report within the cycle deadline (<= 30 min), so an hour of context finds them all. */
const CYCLE_MARGIN_MS = HOUR_MS;
/**
 * A cycle with a persisted deadline settles at that deadline. Without a snapshot (cycle closure off) the
 * longest deadline is 1800 s plus two check timeouts (synthetic checks run a whole test), so wait 60 min.
 */
const CYCLE_SETTLE_MS = 60 * 60_000;

/** A raw check as the aggregates and the stats tail read it. */
export interface CheckRow {
  checkedAt: Date;
  location: string;
  isUp: boolean;
  responseTimeMs: number | null;
  isStatusChange: boolean;
  executionGroupId: string | null;
  /** Regions the worker enqueued for this cycle (details.expectedLocations); absent on older rows. */
  expectedLocations?: string[] | null;
}

/** Region rule of one cycle: the persisted cycle snapshot, or the monitor's current config. */
export interface CyclePolicy {
  strategy: "all" | "any" | "majority";
  threshold: number;
  expected: string[];
  /** Persisted cycle deadline (ms); the cycle is in flight until then. */
  deadlineAt?: number;
}

/** `hint` = union of the regions the worker enqueued for the group, when its rows say so. */
type PolicyResolver = (
  executionGroupId: string,
  observed: string[],
  hint: string[] | null,
) => CyclePolicy | null;

/**
 * Same decision as the worker's decideMonitorCycle once a cycle is over (deadline elapsed):
 * a region that never reported counts as down. `null` policy = one region, up when it is up.
 */
export function isCycleUp(
  policy: CyclePolicy | null,
  results: Record<string, boolean>,
): boolean {
  if (!policy) return Object.values(results).some(Boolean);
  const expected = [...new Set(policy.expected)];
  const seen = expected.filter((location) => location in results);
  const up = seen.filter((location) => results[location]).length;
  return cycleUpFromCounts({ ...policy, expected: expected.length }, seen.length, up);
}

/**
 * The same rule from counts alone (regions expected / reported / up), for the SQL-summarised tail.
 * `null` policy = one region: up when it is up.
 */
export function cycleUpFromCounts(
  policy: { strategy: CyclePolicy["strategy"]; threshold: number; expected: number } | null,
  observed: number,
  up: number,
): boolean {
  if (!policy) return up > 0;
  const required =
    policy.strategy === "all"
      ? policy.expected
      : policy.strategy === "any"
        ? 1
        : Math.ceil((policy.expected * policy.threshold) / 100);
  return observed > 0 && up >= required;
}

/**
 * Collapse raw rows into checks. A cycle is attributed to the time of its earliest row, so it is
 * counted once even when its regions straddle an hour or day boundary. Rows without an
 * execution group are one check each. A cycle still waiting for a region (not every expected region
 * reported and its deadline, or CYCLE_SETTLE_MS after it began, has not passed) is left out until it settles, so a check in
 * flight is not shown as down.
 */
export function groupChecks(
  rows: CheckRow[],
  resolve: PolicyResolver,
  nowMs: number = Date.now(),
): { start: number; isUp: boolean }[] {
  const checks: { start: number; isUp: boolean }[] = [];
  const groups = new Map<string, CheckRow[]>();
  for (const row of rows) {
    if (!row.executionGroupId) {
      checks.push({ start: row.checkedAt.getTime(), isUp: row.isUp });
      continue;
    }
    const group = groups.get(row.executionGroupId);
    if (group) group.push(row);
    else groups.set(row.executionGroupId, [row]);
  }
  for (const [groupId, group] of groups) {
    group.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
    const results: Record<string, boolean> = {};
    // Latest row per region wins (a retried region replaces its earlier attempt).
    for (const row of group) results[row.location] = row.isUp;
    const hint = [...new Set(group.flatMap((row) => row.expectedLocations ?? []))];
    const policy = resolve(groupId, Object.keys(results), hint.length > 0 ? hint : null);
    const start = group[0].checkedAt.getTime();
    const waiting = policy?.expected.some((location) => !(location in results));
    if (waiting && nowMs < (policy?.deadlineAt ?? start + CYCLE_SETTLE_MS)) continue;
    checks.push({ start, isUp: isCycleUp(policy, results) });
  }
  return checks;
}

/** The monitor's current multi-region rule, or null for a single-region monitor. */
async function loadConfiguredPolicy(
  monitorId: string,
): Promise<{ strategy: CyclePolicy["strategy"]; threshold: number; expected: number } | null> {
  const [monitor] = await db
    .select({ config: monitors.config })
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .limit(1);
  const locationConfig = monitor?.config?.locationConfig;
  if (!locationConfig?.enabled || !locationConfig.locations?.length) return null;
  const { strategy, threshold } = monitorCyclePolicy(locationConfig);
  return { strategy, threshold, expected: new Set(locationConfig.locations).size };
}

/**
 * Policy lookup for a monitor's rows: the persisted monitor_cycles snapshot where one exists, otherwise the
 * monitor's current region config (history keeps today's rule; legacy grouped rows have no snapshot).
 */
async function loadPolicyResolver(
  monitorId: string,
  rows: CheckRow[],
): Promise<PolicyResolver> {
  if (!rows.some((row) => row.executionGroupId)) return () => null;
  const [monitor] = await db
    .select({ config: monitors.config })
    .from(monitors)
    .where(eq(monitors.id, monitorId))
    .limit(1);
  const current = monitorCyclePolicy(monitor?.config?.locationConfig);
  const configured =
    monitor?.config?.locationConfig?.enabled &&
    monitor.config.locationConfig.locations?.length
      ? monitor.config.locationConfig.locations
      : null;

  let oldest = Infinity;
  let newest = -Infinity;
  for (const row of rows) {
    const t = row.checkedAt.getTime();
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  const cycles = await db
    .select({
      id: monitorCycles.id,
      strategy: monitorCycles.strategy,
      threshold: monitorCycles.threshold,
      expectedLocations: monitorCycles.expectedLocations,
      deadlineAt: monitorCycles.deadlineAt,
    })
    .from(monitorCycles)
    .where(
      and(
        eq(monitorCycles.monitorId, monitorId),
        gte(monitorCycles.scheduledFor, new Date(oldest - CYCLE_MARGIN_MS)),
        lte(monitorCycles.scheduledFor, new Date(newest)),
      ),
    );
  const snapshots = new Map(cycles.map((cycle) => [cycle.id, cycle]));

  return (groupId, observed, hint) => {
    const snapshot = snapshots.get(groupId);
    if (snapshot) {
      return {
        strategy: snapshot.strategy,
        threshold: snapshot.threshold,
        expected: snapshot.expectedLocations,
        deadlineAt: snapshot.deadlineAt.getTime(),
      };
    }
    if (!configured) return null;
    // Without a snapshot, judge over the regions the worker enqueued (skipped regions never count as down);
    // only rows without that detail fall back to the current configuration.
    return {
      ...current,
      expected: hint ?? [...new Set([...configured, ...observed])],
    };
  };
}

// ============================================================================
// RESPONSE-TIME HISTOGRAM
// ============================================================================

/**
 * Daily rows keep a log-bucketed histogram of up-check response times (bucket width 5%, so a percentile read
 * from merged buckets is within ~2.5% of the true value). Sparse JSON, typically 20-40 entries (< 1 KB).
 * It makes a real 30-day p95 possible without scanning 30 days of raw rows or averaging per-day p95s.
 */
export type ResponseHistogram = Record<string, number>;
const HISTOGRAM_GAMMA = 1.05;
const HISTOGRAM_LN = Math.log(HISTOGRAM_GAMMA);

export function addToHistogram(histogram: ResponseHistogram, ms: number, count = 1): void {
  if (!(ms > 0)) return;
  const bucket = String(Math.floor(Math.log(ms) / HISTOGRAM_LN));
  histogram[bucket] = (histogram[bucket] ?? 0) + count;
}

export function histogramPercentile(
  histogram: ResponseHistogram,
  percentile: number,
): number | null {
  const buckets = Object.entries(histogram)
    .map(([bucket, count]) => [Number(bucket), count] as const)
    .sort((a, b) => a[0] - b[0]);
  const total = buckets.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil((percentile / 100) * total));
  let cumulative = 0;
  for (const [bucket, count] of buckets) {
    cumulative += count;
    if (cumulative >= rank) return Math.round(HISTOGRAM_GAMMA ** (bucket + 0.5));
  }
  return null;
}

type AggregateRow = typeof monitorAggregates.$inferSelect;

/**
 * Rows written before histograms existed only carry p50/p95/p99/max: spread the row's samples over
 * those points (50% / 45% / 4% / 1%) so its tail still weighs into a merged percentile.
 */
function histogramOfRow(row: AggregateRow): { histogram: ResponseHistogram; samples: number } {
  const samples = sampleCountOfRow(row);
  if (row.responseHistogram) return { histogram: row.responseHistogram, samples };
  const histogram: ResponseHistogram = {};
  const points: [number | null, number][] = [
    [row.p50ResponseMs, 0.5],
    [row.p95ResponseMs, 0.45],
    [row.p99ResponseMs, 0.04],
    [row.maxResponseMs, 0.01],
  ];
  const known = points.filter(([value]) => value !== null && value > 0);
  if (known.length === 0 || samples === 0) return { histogram, samples };
  const weight = known.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of known) {
    addToHistogram(histogram, value!, Math.max(1, Math.round((samples * w) / weight)));
  }
  return { histogram, samples };
}

/** Exact count where persisted; older rows derive it from sum / rounded average (the previous behaviour). */
function sampleCountOfRow(row: AggregateRow): number {
  if (row.responseSampleCount !== null && row.responseSampleCount !== undefined) {
    return row.responseSampleCount;
  }
  if (!row.totalResponseMs) return 0;
  if (row.avgResponseMs && row.avgResponseMs > 0) {
    return Math.round(row.totalResponseMs / row.avgResponseMs);
  }
  return row.successfulChecks;
}

// ============================================================================
// MAIN AGGREGATION SERVICE
// ============================================================================

/** Totals of a window, from aggregates plus the raw rows aggregates do not cover. */
export interface WindowMetrics {
  totalChecks: number;
  successfulChecks: number;
  /** Null when the window holds no checks. */
  uptimePercentage: number | null;
  avgResponseMs: number | null;
  /** Real percentile over up-check response times (histogram-merged, within ~2.5%). Null below 5 samples. */
  p95ResponseMs: number | null;
}

const MIN_P95_SAMPLES = AGGREGATION_CONFIG.MIN_CHECKS_FOR_P95;
const INSERT_CHUNK = 200;

const isUpSample = (row: CheckRow) =>
  row.isUp && row.responseTimeMs !== null && row.responseTimeMs > 0;

/** Read the raw checks of the given [from, to) ranges (excluding superseded synthetic rows). */
async function fetchCheckRows(
  monitorId: string,
  ranges: [number, number][],
  location?: string | null,
): Promise<CheckRow[]> {
  if (ranges.length === 0) return [];
  return db
    .select({
      checkedAt: monitorResults.checkedAt,
      location: monitorResults.location,
      isUp: monitorResults.isUp,
      responseTimeMs: monitorResults.responseTimeMs,
      isStatusChange: monitorResults.isStatusChange,
      executionGroupId: monitorResults.executionGroupId,
      expectedLocations: sql<string[] | null>`CASE WHEN jsonb_typeof(${monitorResults.details}->'expectedLocations') = 'array' THEN ${monitorResults.details}->'expectedLocations' END`,
    })
    .from(monitorResults)
    .where(
      and(
        eq(monitorResults.monitorId, monitorId),
        or(
          ...ranges.map(([from, to]) =>
            and(
              gte(monitorResults.checkedAt, new Date(from)),
              lt(monitorResults.checkedAt, new Date(to)),
            ),
          ),
        ),
        excludeSupersededSyntheticResults,
        location ? eq(monitorResults.location, location as MonitoringLocation) : undefined,
      ),
    );
}

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
    const currentHour = truncateToHour(new Date());
    const lookbackStart = new Date(currentHour);
    lookbackStart.setUTCHours(
      lookbackStart.getUTCHours() - AGGREGATION_CONFIG.HOURLY_LOOKBACK_HOURS,
    );
    return this.runAggregation("hourly", lookbackStart, currentHour);
  }

  /**
   * Run daily aggregation for all monitors
   * Computes metrics for the previous complete day(s).
   * `lookbackDays` lets an operator rebuild further back once (bounded by raw retention).
   */
  async runDailyAggregation(
    lookbackDays: number = AGGREGATION_CONFIG.DAILY_LOOKBACK_DAYS,
  ): Promise<AggregationResult> {
    const currentDay = truncateToDay(new Date());
    const lookbackStart = new Date(currentDay);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - lookbackDays);
    return this.runAggregation("daily", lookbackStart, currentDay);
  }

  /**
   * Aggregate every monitor that is enabled or has raw rows in the lookback. A monitor paused (or an
   * aggregator outage) mid-period would otherwise lose its last partial hour/day for good.
   */
  private async runAggregation(
    periodType: AggregationPeriod,
    lookbackStart: Date,
    end: Date,
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    const label = periodType === "hourly" ? "Hourly" : "Daily";
    const result: AggregationResult = {
      success: true,
      periodType,
      monitorsProcessed: 0,
      aggregatesCreated: 0,
      aggregatesUpdated: 0,
      duration: 0,
      errors: [],
    };

    try {
      const hasRecentRows = sql`exists (
        select 1 from monitor_results r
        where r.monitor_id = ${monitors.id}
          and r.checked_at >= ${lookbackStart.toISOString()}::timestamptz
      )`;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const monitorBatch = await db
          .select({ id: monitors.id, organizationId: monitors.organizationId })
          .from(monitors)
          .where(or(eq(monitors.enabled, true), hasRecentRows))
          // Stable order, or offset paging can skip or repeat monitors between batches.
          .orderBy(monitors.id)
          .limit(AGGREGATION_CONFIG.MONITOR_BATCH_SIZE)
          .offset(offset);

        for (const monitor of monitorBatch) {
          try {
            const { created, updated } = await this.aggregateMonitor(
              monitor.id,
              periodType,
              lookbackStart,
              end,
            );
            result.aggregatesCreated += created;
            result.aggregatesUpdated += updated;
            result.monitorsProcessed++;
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            result.errors.push(
              `Monitor ${monitor.id.substring(0, 8)}: ${errorMsg}`,
            );
          }
        }

        offset += AGGREGATION_CONFIG.MONITOR_BATCH_SIZE;
        hasMore = monitorBatch.length === AGGREGATION_CONFIG.MONITOR_BATCH_SIZE;
      }

      result.duration = Date.now() - startTime;

      if (result.errors.length > 0) {
        console.warn(
          `[AGGREGATION] ${label} completed with ${result.errors.length} errors`,
        );
      } else {
        console.log(
          `[AGGREGATION] ${label} completed: ${result.monitorsProcessed} monitors, ` +
            `${result.aggregatesCreated} created, ${result.aggregatesUpdated} updated`,
        );
      }
    } catch (error) {
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      result.duration = Date.now() - startTime;
      console.error(`[AGGREGATION] ${label} aggregation failed:`, error);
    }

    return result;
  }

  /**
   * Recompute every period of [start, end) for one monitor from a single scan of its raw rows
   * (plus a margin so cycles that straddle a boundary are seen whole). Idempotent: upserts the
   * periods that have rows and deletes stale rows of periods that no longer do.
   */
  private async aggregateMonitor(
    monitorId: string,
    periodType: AggregationPeriod,
    start: Date,
    end: Date,
  ): Promise<{ created: number; updated: number }> {
    const unit = PERIOD_MS[periodType];
    const from = start.getTime();
    const to = end.getTime();
    const rows = await fetchCheckRows(monitorId, [
      [from - CYCLE_MARGIN_MS, to + CYCLE_MARGIN_MS],
    ]);
    const resolve = await loadPolicyResolver(monitorId, rows);
    const periodOf = (ms: number) => Math.floor(ms / unit) * unit;

    const inRange = rows.filter((row) => {
      const t = row.checkedAt.getTime();
      return t >= from && t < to;
    });
    const byPeriod = new Map<number, CheckRow[]>();
    for (const row of inRange) {
      const key = periodOf(row.checkedAt.getTime());
      const list = byPeriod.get(key);
      if (list) list.push(row);
      else byPeriod.set(key, [row]);
    }
    const checksByPeriod = new Map<number, { total: number; up: number }>();
    for (const check of groupChecks(rows, resolve)) {
      if (check.start < from || check.start >= to) continue;
      const key = periodOf(check.start);
      const counts = checksByPeriod.get(key) ?? { total: 0, up: 0 };
      counts.total++;
      if (check.isUp) counts.up++;
      checksByPeriod.set(key, counts);
    }

    const now = new Date();
    const build = (
      periodStart: number,
      location: MonitoringLocation | null,
      periodRows: CheckRow[],
      counts: { total: number; up: number },
    ): MonitorAggregateInsert => {
      const samples = periodRows.filter(isUpSample).map((row) => row.responseTimeMs!);
      const metrics = computeMetrics({
        totalChecks: counts.total,
        successfulChecks: counts.up,
        failedChecks: counts.total - counts.up,
        responseTimes: samples,
        statusChangeCount: periodRows.filter((row) => row.isStatusChange).length,
      });
      let responseHistogram: ResponseHistogram | null = null;
      if (periodType === "daily" && samples.length > 0) {
        responseHistogram = {};
        for (const ms of samples) addToHistogram(responseHistogram, ms);
      }
      return {
        monitorId,
        periodType,
        periodStart: new Date(periodStart),
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
        responseSampleCount: metrics.responseSampleCount,
        responseHistogram,
        statusChangeCount: metrics.statusChangeCount,
        updatedAt: now,
      };
    };

    const located: MonitorAggregateInsert[] = [];
    const combined: MonitorAggregateInsert[] = [];
    for (const [periodStart, periodRows] of byPeriod) {
      const byLocation = new Map<string, CheckRow[]>();
      for (const row of periodRows) {
        const list = byLocation.get(row.location);
        if (list) list.push(row);
        else byLocation.set(row.location, [row]);
      }
      for (const [location, locationRows] of byLocation) {
        const up = locationRows.filter((row) => row.isUp).length;
        located.push(
          build(periodStart, location as MonitoringLocation, locationRows, {
            total: locationRows.length,
            up,
          }),
        );
      }
      // Always write the combined row: a period whose cycles all started in the previous period has rows but
      // no checks of its own, and without a combined row readers would fall back to summing regional rows.
      const counts = checksByPeriod.get(periodStart) ?? { total: 0, up: 0 };
      combined.push(build(periodStart, null, periodRows, counts));
    }

    // Raw rows are purged by retention (shorter than aggregate retention) but status-change rows are kept, so
    // the oldest ordinary row marks how far raw history really reaches. A period older than that, which
    // already has an aggregate (the period holding the oldest row is still recomputed), is never rewritten or deleted: its raw rows may be partly or wholly purged.
    const [oldestRaw] = await db
      .select({ checkedAt: monitorResults.checkedAt })
      .from(monitorResults)
      .where(and(eq(monitorResults.monitorId, monitorId), eq(monitorResults.isStatusChange, false)))
      .orderBy(monitorResults.checkedAt)
      .limit(1);
    const rawFloor = oldestRaw ? oldestRaw.checkedAt.getTime() : Infinity;
    const existing = await db
      .select({
        id: monitorAggregates.id,
        periodStart: monitorAggregates.periodStart,
        location: monitorAggregates.location,
        totalChecks: monitorAggregates.totalChecks,
      })
      .from(monitorAggregates)
      .where(
        and(
          eq(monitorAggregates.monitorId, monitorId),
          eq(monitorAggregates.periodType, periodType),
          gte(monitorAggregates.periodStart, start),
          lt(monitorAggregates.periodStart, end),
        ),
      );
    const frozen = new Set(
      existing.map((row) => row.periodStart.getTime()).filter((t) => t < periodOf(rawFloor)),
    );

    let created = 0;
    let updated = 0;
    const target = [
      monitorAggregates.monitorId,
      monitorAggregates.periodType,
      monitorAggregates.periodStart,
    ];
    const upsert = async (batch: MonitorAggregateInsert[], withLocation: boolean) => {
      for (let i = 0; i < batch.length; i += INSERT_CHUNK) {
        const written = await db
          .insert(monitorAggregates)
          .values(batch.slice(i, i + INSERT_CHUNK))
          .onConflictDoUpdate({
            target: withLocation ? [...target, monitorAggregates.location] : target,
            // PostgreSQL's ordinary unique index treats NULL locations as distinct.
            ...(withLocation
              ? {}
              : { targetWhere: sql`${monitorAggregates.location} IS NULL` }),
            set: {
              totalChecks: sql`excluded.total_checks`,
              successfulChecks: sql`excluded.successful_checks`,
              failedChecks: sql`excluded.failed_checks`,
              uptimePercentage: sql`excluded.uptime_percentage`,
              avgResponseMs: sql`excluded.avg_response_ms`,
              minResponseMs: sql`excluded.min_response_ms`,
              maxResponseMs: sql`excluded.max_response_ms`,
              p50ResponseMs: sql`excluded.p50_response_ms`,
              p95ResponseMs: sql`excluded.p95_response_ms`,
              p99ResponseMs: sql`excluded.p99_response_ms`,
              totalResponseMs: sql`excluded.total_response_ms`,
              responseSampleCount: sql`excluded.response_sample_count`,
              responseHistogram: sql`excluded.response_histogram`,
              statusChangeCount: sql`excluded.status_change_count`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .returning({ inserted: sql<boolean>`xmax = 0` });
        for (const { inserted } of written) {
          if (inserted) created++;
          else updated++;
        }
      }
    };
    // The period holding the oldest raw row may be partly purged: never shrink its existing aggregate.
    const existingChecks = new Map(
      existing.map((row) => [`${row.periodStart.getTime()}|${row.location ?? ""}`, row.totalChecks]),
    );
    const boundary = periodOf(rawFloor);
    const writable = (row: MonitorAggregateInsert) => {
      const t = row.periodStart.getTime();
      if (frozen.has(t)) return false;
      if (t !== boundary) return true;
      const previous = existingChecks.get(`${t}|${row.location ?? ""}`);
      return previous === undefined || (row.totalChecks ?? 0) >= previous;
    };
    await upsert(located.filter(writable), true);
    await upsert(combined.filter(writable), false);

    // Delete rows of this range that the data no longer supports (e.g. the last raw rows of a period were
    // removed, or a superseded synthetic row was replaced), instead of keeping a stale aggregate forever.
    const keep = new Set(
      [...located, ...combined].map(
        (row) => `${row.periodStart.getTime()}|${row.location ?? ""}`,
      ),
    );
    const rawReachesBack = periodOf(rawFloor);
    const stale = existing
      .filter(
        (row) =>
          row.periodStart.getTime() > rawReachesBack &&
          !keep.has(`${row.periodStart.getTime()}|${row.location ?? ""}`),
      )
      .map((row) => row.id);
    if (stale.length > 0) {
      await db.delete(monitorAggregates).where(inArray(monitorAggregates.id, stale));
    }

    return { created, updated };
  }

  /**
   * Aggregated rows of a window, one logical row per period: the combined row, or the location rollups when
   * an older period has no combined row. A location filter reads that location's rows.
   */
  private async loadAggregateRows(
    monitorId: string,
    periodType: AggregationPeriod,
    startTime: Date,
    endTime: Date,
    location?: MonitoringLocation | null,
  ): Promise<AggregateRow[]> {
    const conditions = [
      eq(monitorAggregates.monitorId, monitorId),
      eq(monitorAggregates.periodType, periodType),
      gte(monitorAggregates.periodStart, startTime),
      lt(monitorAggregates.periodStart, endTime),
    ];

    if (location) {
      conditions.push(eq(monitorAggregates.location, location));
    }

    const rows = await db
      .select()
      .from(monitorAggregates)
      .where(and(...conditions))
      .orderBy(desc(monitorAggregates.periodStart));

    // Prefer a combined row per period; older periods may only have location rollups.
    const combinedPeriods = new Set(
      rows
        .filter((row) => row.location === null)
        .map((row) => row.periodStart.getTime()),
    );
    return location
      ? rows
      : rows.filter(
          (row) =>
            row.location === null ||
            !combinedPeriods.has(row.periodStart.getTime()),
        );
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
    location?: MonitoringLocation | null,
  ): Promise<{
    uptimePercentage: number;
    avgResponseMs: number | null;
    p95ResponseMs: number | null;
    totalChecks: number;
    /** Exact count of up checks (no rebuilding from the rounded percentage). */
    successfulChecks: number;
    /** Sum and count of the up-check response times behind avgResponseMs. */
    totalResponseMs: number;
    responseSampleCount: number;
    /** Merged response-time histogram of the window (see ResponseHistogram). */
    histogram: ResponseHistogram;
    /** Start times (ms) of the periods that have aggregate rows. */
    periodStarts: number[];
    /** End of the newest aggregated period; raw results from there on are not yet aggregated. Null when there are none. */
    coveredTo: Date | null;
  }> {
    const aggregates = await this.loadAggregateRows(
      monitorId,
      periodType,
      startTime,
      endTime,
      location,
    );

    if (aggregates.length === 0) {
      return {
        uptimePercentage: 0,
        avgResponseMs: null,
        p95ResponseMs: null,
        totalChecks: 0,
        successfulChecks: 0,
        totalResponseMs: 0,
        responseSampleCount: 0,
        histogram: {},
        periodStarts: [],
        coveredTo: null,
      };
    }

    let totalChecks = 0;
    let successfulChecks = 0;
    let totalResponseMs = 0;
    let responseSampleCount = 0;
    const histogram: ResponseHistogram = {};

    for (const agg of aggregates) {
      totalChecks += agg.totalChecks;
      successfulChecks += agg.successfulChecks;
      const part = histogramOfRow(agg);
      totalResponseMs += agg.totalResponseMs ?? 0;
      responseSampleCount += part.samples;
      for (const [bucket, count] of Object.entries(part.histogram)) {
        histogram[bucket] = (histogram[bucket] ?? 0) + count;
      }
    }

    return {
      uptimePercentage: Number(
        (totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : 0).toFixed(2),
      ),
      avgResponseMs:
        responseSampleCount > 0
          ? Math.round(totalResponseMs / responseSampleCount)
          : null,
      p95ResponseMs:
        responseSampleCount >= MIN_P95_SAMPLES
          ? histogramPercentile(histogram, 95)
          : null,
      totalChecks,
      successfulChecks,
      totalResponseMs,
      responseSampleCount,
      histogram,
      periodStarts: aggregates.map((agg) => agg.periodStart.getTime()),
      coveredTo: new Date(
        Math.max(...aggregates.map((agg) => agg.periodStart.getTime())) +
          PERIOD_MS[periodType],
      ),
    };
  }

  /**
   * Metrics of [windowStart, now]: the aggregate rows plus the raw checks of every part of the window the
   * aggregates do not cover. The gaps are found from the periods that actually have rows (the oldest partial
   * period, the in-progress one, and any period the aggregator missed or skipped), so a pause or an aggregator
   * outage does not hide checks. Without a location filter uptime counts checks (cycles), with one it counts
   * that region's rows.
   *
   * The gaps are summarised in the database (one row per distinct cycle shape, one per response bucket), never
   * loaded as rows, so a window with no aggregates at all costs the same memory as a full one.
   */
  async getWindowMetrics(
    monitorId: string,
    periodType: AggregationPeriod,
    windowStart: Date,
    now: Date,
    location?: MonitoringLocation | null,
  ): Promise<WindowMetrics> {
    const unit = PERIOD_MS[periodType];
    const first = Math.ceil(windowStart.getTime() / unit) * unit;
    const last = Math.floor(now.getTime() / unit) * unit;
    // The in-progress period is always read raw, so never also from an aggregate row.
    const agg = await this.getAggregatedMetrics(
      monitorId,
      periodType,
      windowStart,
      new Date(last),
      location,
    );
    const covered = new Set(agg.periodStarts);

    const gaps: [number, number][] = [];
    const addGap = (gapFrom: number, gapTo: number) => {
      if (gapTo <= gapFrom) return;
      const previous = gaps[gaps.length - 1];
      if (previous && previous[1] === gapFrom) previous[1] = gapTo;
      else gaps.push([gapFrom, gapTo]);
    };
    addGap(windowStart.getTime(), Math.min(first, now.getTime() + 1));
    for (let p = first; p < last; p += unit) {
      if (!covered.has(p)) addGap(p, p + unit);
    }
    addGap(Math.max(last, first), now.getTime() + 1);

    let totalChecks = agg.totalChecks;
    let successfulChecks = agg.successfulChecks;
    let totalResponseMs = agg.totalResponseMs;
    let responseSampleCount = agg.responseSampleCount;
    const histogram: ResponseHistogram = { ...agg.histogram };

    if (gaps.length > 0) {
      const inRanges = (column: SQL | typeof monitorResults.checkedAt, ranges: [number, number][]) =>
        sql.join(
          ranges.map(
            ([a, b]) =>
              sql`(${column} >= ${new Date(a).toISOString()}::timestamptz AND ${column} < ${new Date(b).toISOString()}::timestamptz)`,
          ),
          sql` OR `,
        );
      const base = and(
        eq(monitorResults.monitorId, monitorId),
        excludeSupersededSyntheticResults,
        location ? eq(monitorResults.location, location) : undefined,
      );

      if (location) {
        const [counts] = await db
          .select({
            total: sql<number>`count(*)::int`,
            up: sql<number>`(count(*) filter (where ${monitorResults.isUp}))::int`,
          })
          .from(monitorResults)
          .where(and(base, sql`(${inRanges(monitorResults.checkedAt, gaps)})`));
        totalChecks += counts?.total ?? 0;
        successfulChecks += counts?.up ?? 0;
      } else {
        const configured = await loadConfiguredPolicy(monitorId);
        const margin = gaps.map(([a, b]): [number, number] => [a - CYCLE_MARGIN_MS, b + CYCLE_MARGIN_MS]);
        const nowIso = now.toISOString();
        // One row per cycle shape: regions reported / up (restricted to the cycle's expected set, latest attempt
        // per region), the expected-set size, and the cycle's own rule if persisted.
        const shapes = await db.execute<{
          observed: number;
          up: number;
          recent: boolean;
          strategy: CyclePolicy["strategy"] | null;
          threshold: number | null;
          expected: number | null;
          cycles: number;
        }>(sql`
          WITH b AS (
            SELECT ${monitorResults.id} AS id, ${monitorResults.executionGroupId} AS gid,
              ${monitorResults.location} AS location, ${monitorResults.isUp} AS is_up,
              ${monitorResults.checkedAt} AS checked_at,
              CASE WHEN jsonb_typeof(${monitorResults.details}->'expectedLocations') = 'array'
                THEN ${monitorResults.details}->'expectedLocations' END AS e
            FROM ${monitorResults}
            WHERE ${base} AND ${monitorResults.executionGroupId} IS NOT NULL AND (${inRanges(monitorResults.checkedAt, margin)})
          ),
          ex AS (
            SELECT b.gid, array_agg(DISTINCT x) AS arr
            FROM b, LATERAL jsonb_array_elements_text(b.e) AS x
            WHERE b.e IS NOT NULL
            GROUP BY b.gid
          ),
          r AS (
            SELECT b.gid, b.location, b.is_up,
              min(b.checked_at) OVER (PARTITION BY b.gid) AS first_at,
              -- the latest attempt of a region decides, as in groupChecks
              row_number() OVER (PARTITION BY b.gid, b.location ORDER BY b.checked_at DESC, b.id DESC) AS rn,
              c.strategy, c.threshold, c.deadline_at,
              -- expected regions: the persisted snapshot, else what the worker enqueued, else unknown
              CASE WHEN c.id IS NOT NULL THEN ARRAY(SELECT jsonb_array_elements_text(c.expected_locations))
                   ELSE ex.arr END AS exp
            FROM b
            LEFT JOIN ex ON ex.gid = b.gid
            LEFT JOIN ${monitorCycles} c ON c.id = b.gid AND c.monitor_id = ${monitorId}
          ),
          g AS (
            SELECT gid, min(first_at) AS first_at, max(deadline_at) AS deadline_at,
              (count(*) FILTER (WHERE exp IS NULL OR location = ANY(exp)))::int AS observed,
              (count(*) FILTER (WHERE is_up AND (exp IS NULL OR location = ANY(exp))))::int AS up,
              max(strategy) AS strategy, max(threshold) AS threshold, max(cardinality(exp)) AS expected
            FROM r WHERE rn = 1
            GROUP BY gid
            HAVING ${inRanges(sql`min(first_at)`, gaps)}
          )
          SELECT observed, up,
            (${nowIso}::timestamptz < COALESCE(deadline_at, first_at + interval '60 minutes')) AS recent,
            strategy, threshold, expected, count(*)::int AS cycles
          FROM g
          GROUP BY 1, 2, 3, 4, 5, 6`);
        for (const shape of shapes) {
          const policy = shape.strategy
            ? { strategy: shape.strategy, threshold: shape.threshold ?? 50, expected: shape.expected ?? 0 }
            : configured && { ...configured, expected: shape.expected ?? Math.max(configured.expected, shape.observed) };
          if (policy && shape.recent && shape.observed < policy.expected) continue; // still in flight
          totalChecks += shape.cycles;
          if (cycleUpFromCounts(policy || null, shape.observed, shape.up)) successfulChecks += shape.cycles;
        }
        const [solo] = await db
          .select({
            total: sql<number>`count(*)::int`,
            up: sql<number>`(count(*) filter (where ${monitorResults.isUp}))::int`,
          })
          .from(monitorResults)
          .where(and(base, sql`${monitorResults.executionGroupId} IS NULL`, sql`(${inRanges(monitorResults.checkedAt, gaps)})`));
        totalChecks += solo?.total ?? 0;
        successfulChecks += solo?.up ?? 0;
      }

      const bucket = sql<number>`floor(ln(${monitorResults.responseTimeMs}) / ${HISTOGRAM_LN})::int`;
      const samples = await db
        .select({
          bucket,
          n: sql<number>`count(*)::int`,
          sum: sql<number>`sum(${monitorResults.responseTimeMs})::bigint`,
        })
        .from(monitorResults)
        .where(
          and(
            base,
            eq(monitorResults.isUp, true),
            sql`${monitorResults.responseTimeMs} > 0`,
            sql`(${inRanges(monitorResults.checkedAt, gaps)})`,
          ),
        )
        .groupBy(sql`1`);
      for (const sample of samples) {
        responseSampleCount += Number(sample.n);
        totalResponseMs += Number(sample.sum);
        const key = String(sample.bucket);
        histogram[key] = (histogram[key] ?? 0) + Number(sample.n);
      }
    }

    return {
      totalChecks,
      successfulChecks,
      uptimePercentage: totalChecks > 0 ? (successfulChecks / totalChecks) * 100 : null,
      avgResponseMs:
        responseSampleCount > 0 ? Math.round(totalResponseMs / responseSampleCount) : null,
      p95ResponseMs:
        responseSampleCount >= MIN_P95_SAMPLES ? histogramPercentile(histogram, 95) : null,
    };
  }

  /**
   * Exact p95 of up-check response times since `since` from raw rows (percentile_cont). Used for the 24h
   * window where raw is a few thousand rows; null below the minimum sample count.
   */
  async getRawP95(
    monitorId: string,
    since: Date,
    location?: MonitoringLocation | null,
  ): Promise<number | null> {
    const [row] = await db
      .select({
        samples: sql<number>`count(*)`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${monitorResults.responseTimeMs})`,
      })
      .from(monitorResults)
      .where(
        and(
          eq(monitorResults.monitorId, monitorId),
          gte(monitorResults.checkedAt, since),
          eq(monitorResults.isUp, true),
          sql`${monitorResults.responseTimeMs} > 0`,
          location ? eq(monitorResults.location, location) : undefined,
        ),
      );
    if (!row || Number(row.samples) < MIN_P95_SAMPLES || row.p95 === null) return null;
    return Math.round(Number(row.p95));
  }

  /** True when the monitor is configured for the location or has ever recorded a result there. */
  async monitorHasLocation(
    monitorId: string,
    configuredLocations: readonly string[] | undefined,
    location: string,
  ): Promise<boolean> {
    // Location codes are varchar(50) text; anything else cannot match a row.
    if (location.length === 0 || location.length > 50) return false;
    if (configuredLocations?.includes(location)) return true;
    const [row] = await db
      .select({ id: monitorResults.id })
      .from(monitorResults)
      .where(
        and(
          eq(monitorResults.monitorId, monitorId),
          eq(monitorResults.location, location as MonitoringLocation),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * Clean up old aggregate records based on retention policy
   */
  async cleanupOldAggregates(
    hourlyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_HOURLY_RETENTION_DAYS,
    dailyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_DAILY_RETENTION_DAYS,
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
          lt(monitorAggregates.periodStart, hourlyCutoff),
        ),
      )
      .returning({ id: monitorAggregates.id });

    // Delete old daily aggregates
    const dailyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          eq(monitorAggregates.periodType, "daily"),
          lt(monitorAggregates.periodStart, dailyCutoff),
        ),
      )
      .returning({ id: monitorAggregates.id });

    const hourlyDeleted = hourlyResult.length;
    const dailyDeleted = dailyResult.length;

    if (hourlyDeleted > 0 || dailyDeleted > 0) {
      console.log(
        `[AGGREGATION] Cleanup: deleted ${hourlyDeleted} hourly, ${dailyDeleted} daily aggregates`,
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
    dailyRetentionDays: number = AGGREGATION_CONFIG.DEFAULT_DAILY_RETENTION_DAYS,
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
          lt(monitorAggregates.periodStart, hourlyCutoff),
        ),
      )
      .returning({ id: monitorAggregates.id });

    // Delete old daily aggregates for org's monitors
    const dailyResult = await db
      .delete(monitorAggregates)
      .where(
        and(
          inArray(monitorAggregates.monitorId, monitorIds),
          eq(monitorAggregates.periodType, "daily"),
          lt(monitorAggregates.periodStart, dailyCutoff),
        ),
      )
      .returning({ id: monitorAggregates.id });

    const hourlyDeleted = hourlyResult.length;
    const dailyDeleted = dailyResult.length;
    const totalDeleted = hourlyDeleted + dailyDeleted;

    if (totalDeleted > 0) {
      console.log(
        `[AGGREGATION] Cleanup for org ${organizationId.substring(0, 8)}: deleted ${hourlyDeleted} hourly, ${dailyDeleted} daily aggregates`,
      );
    }

    return totalDeleted;
  }
}

// Export singleton instance
export const monitorAggregationService = new MonitorAggregationService();
