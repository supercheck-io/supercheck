"use server";

import { searchTraces } from "./index";
import type {
  TraceFilters,
  Trace,
  MetricSeries,
  ContextualMetricsResponse,
  ContextualMetricsSummary,
  ProjectObservabilitySnapshot,
} from "~/types/observability";

const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_BUCKETS = 12;

interface ContextOptions {
  entity: "test" | "job" | "monitor";
  entityId: string;
  projectId?: string;
  organizationId?: string;
  start?: string;
  end?: string;
  bucketCount?: number;
  limit?: number;
}

interface SnapshotOptions {
  projectId: string;
  organizationId?: string;
  lookbackMinutes?: number;
  bucketCount?: number;
  limit?: number;
}

/**
 * Build contextual latency/error metrics for a scoped entity.
 */
export async function buildContextualMetrics({
  entity,
  entityId,
  projectId,
  organizationId,
  start,
  end,
  bucketCount = DEFAULT_BUCKETS,
  limit = 500,
}: ContextOptions): Promise<ContextualMetricsResponse> {
  const endDate = end ? new Date(end) : new Date();
  const startDate = start
    ? new Date(start)
    : new Date(endDate.getTime() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000);

  const filters: TraceFilters = {
    timeRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
    limit,
    offset: 0,
  };

  if (projectId) filters.projectId = projectId;
  if (organizationId) filters.organizationId = organizationId;

  if (entity === "test") {
    filters.testId = entityId;
  } else if (entity === "job") {
    filters.jobId = entityId;
  } else {
    filters.monitorId = entityId;
  }

  const tracesResult = await searchTraces(filters);
  const traces = tracesResult.data;

  return buildMetricsFromTraces(traces, startDate, endDate, bucketCount);
}

/**
 * Build project level observability snapshot for dashboard.
 */
export async function buildProjectObservabilitySnapshot({
  projectId,
  organizationId,
  lookbackMinutes = 60,
  bucketCount = DEFAULT_BUCKETS,
  limit = 500,
}: SnapshotOptions): Promise<ProjectObservabilitySnapshot> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackMinutes * 60 * 1000);

  const filters: TraceFilters = {
    projectId,
    organizationId,
    timeRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
    limit,
    offset: 0,
  };

  const tracesResult = await searchTraces(filters);
  const traces = tracesResult.data;

  const metrics = buildMetricsFromTraces(traces, startDate, endDate, bucketCount);

  const summary = metrics.summary;
  const runsPerMinute =
    metrics.summary.totalSamples > 0
      ? metrics.summary.totalSamples / lookbackMinutes
      : 0;

  return {
    summary: {
      runRatePerMinute: runsPerMinute,
      errorRate: summary.errorRate,
      avgLatencyMs: summary.averageDurationMs,
      p95LatencyMs: summary.p95DurationMs,
      p99LatencyMs: summary.p99DurationMs,
      successRate: summary.successRate,
      totalSamples: summary.totalSamples,
      timeframe: metrics.timeframe,
    },
    throughputSeries: metrics.throughputSeries,
    errorRateSeries: metrics.errorRateSeries,
    latencySeries: metrics.latencySeries,
  };
}

function buildMetricsFromTraces(
  traces: Trace[],
  startDate: Date,
  endDate: Date,
  bucketCount: number
): ContextualMetricsResponse {
  const durations = traces.map((trace) => ({
    durationMs: trace.duration ? trace.duration / 1_000_000 : 0,
    status: trace.status,
    startedAt: trace.startedAt,
  }));

  const sortedDurations = [...durations]
    .map((item) => item.durationMs)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const lastSeenTimestamp =
    durations.length > 0
      ? durations
          .map((d) => new Date(d.startedAt).getTime())
          .sort((a, b) => b - a)[0]
      : undefined;

  const summary: ContextualMetricsSummary = {
    totalSamples: durations.length,
    successRate: computeSuccessRate(durations),
    errorRate: computeErrorRate(durations),
    averageDurationMs: average(durations.map((d) => d.durationMs)) || 0,
    medianDurationMs: percentile(sortedDurations, 0.5) || 0,
    p95DurationMs: percentile(sortedDurations, 0.95) || 0,
    p99DurationMs: percentile(sortedDurations, 0.99) || 0,
    fastestDurationMs: sortedDurations[0] || 0,
    slowestDurationMs: sortedDurations[sortedDurations.length - 1] || 0,
    lastSeenAt: lastSeenTimestamp
      ? new Date(lastSeenTimestamp).toISOString()
      : undefined,
    timeframe: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  };

  const buckets = bucketizeDurations(durations, startDate, endDate, bucketCount);

  const latencySeries: MetricSeries[] = ["p95", "p99"].map((label) => ({
    name: `${label.toUpperCase()} Latency`,
    labels: { percentile: label },
    points: buckets.map((bucket) => ({
      timestamp: bucket.timestamp,
      value:
        label === "p95"
          ? bucket.p95DurationMs
          : label === "p99"
          ? bucket.p99DurationMs
          : 0,
    })),
  }));

  const errorRateSeries: MetricSeries[] = [
    {
      name: "Error Rate",
      labels: { metric: "error_rate" },
      points: buckets.map((bucket) => ({
        timestamp: bucket.timestamp,
        value: bucket.errorRate * 100,
      })),
    },
  ];

  const throughputSeries: MetricSeries[] = [
    {
      name: "Execution Rate",
      labels: { metric: "throughput_per_minute" },
      points: buckets.map((bucket) => ({
        timestamp: bucket.timestamp,
        value: bucket.throughputPerMinute,
      })),
    },
  ];

  return {
    summary,
    latencySeries,
    errorRateSeries,
    throughputSeries,
    timeframe: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  };
}

function bucketizeDurations(
  durations: {
    durationMs: number;
    status: number;
    startedAt: string;
  }[],
  startDate: Date,
  endDate: Date,
  bucketCount: number
) {
  const buckets: Array<{
    timestamp: string;
    durations: number[];
    errors: number;
    total: number;
    p95DurationMs: number;
    p99DurationMs: number;
    throughputPerMinute: number;
    errorRate: number;
  }> = [];

  const start = startDate.getTime();
  const end = endDate.getTime();
  const range = Math.max(end - start, 1);
  const bucketSize = range / bucketCount;

  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = start + i * bucketSize;
    buckets.push({
      timestamp: new Date(bucketStart + bucketSize).toISOString(),
      durations: [],
      errors: 0,
      total: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      throughputPerMinute: 0,
      errorRate: 0,
    });
  }

  durations.forEach((entry) => {
    const started = new Date(entry.startedAt).getTime();
    const bucketIndex = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor(((started - start) / range) * bucketCount))
    );
    const bucket = buckets[bucketIndex];
    bucket.durations.push(entry.durationMs);
    bucket.total += 1;
    if (entry.status === 2) {
      bucket.errors += 1;
    }
  });

  buckets.forEach((bucket) => {
    if (bucket.durations.length === 0) {
      bucket.p95DurationMs = 0;
      bucket.p99DurationMs = 0;
      bucket.throughputPerMinute = 0;
      bucket.errorRate = 0;
      return;
    }

    const sorted = bucket.durations.sort((a, b) => a - b);
    bucket.p95DurationMs = percentile(sorted, 0.95) || 0;
    bucket.p99DurationMs = percentile(sorted, 0.99) || 0;
    bucket.throughputPerMinute =
      bucket.total / Math.max(bucketSize / (60 * 1000), 1);
    bucket.errorRate = bucket.errors / bucket.total;
  });

  return buckets;
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  return (
    sortedValues[lower] * (upper - index) +
    sortedValues[upper] * (index - lower)
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function computeSuccessRate(
  durations: { status: number }[]
): number {
  if (durations.length === 0) return 0;
  const success = durations.filter((d) => d.status !== 2).length;
  return success / durations.length;
}

function computeErrorRate(
  durations: { status: number }[]
): number {
  if (durations.length === 0) return 0;
  const errors = durations.filter((d) => d.status === 2).length;
  return errors / durations.length;
}
