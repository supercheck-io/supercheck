/**
 * Observability Query Utilities
 * Provides helper functions for querying observability data
 */

import type {
  REDMetrics,
  TimeRange,
  Trace,
  SpanStatus,
  ServiceNode,
  ServiceEdge,
  ServiceMapData,
} from "~/types/observability";

// ============================================================================
// CLICKHOUSE CLIENT
// ============================================================================

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";

async function executeQuery<T = unknown>(query: string): Promise<T[]> {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("database", CLICKHOUSE_DATABASE);

  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
  };

  if (CLICKHOUSE_USER && CLICKHOUSE_PASSWORD) {
    const auth = Buffer.from(
      `${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`
    ).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }

  const body = `${query} FORMAT JSONEachRow`;

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ClickHouse query failed (${response.status}): ${errorText}`
      );
    }

    const text = await response.text();
    if (!text.trim()) {
      return [];
    }

    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    console.error("[observability] ClickHouse query failed", error);
    throw error;
  }
}

/**
 * Get service map data (nodes and edges)
 */
export async function getServiceMap(timeRange: TimeRange): Promise<ServiceMapData> {
  try {
    // Get service nodes with metrics
    const nodesResult = await executeQuery<{
      serviceName: string;
      requestCount: bigint;
      errorCount: bigint;
      errorRate: number;
      avgLatency: number;
      p95Latency: number;
    }>(`
        SELECT
          serviceName,
          count() as requestCount,
          sum(statusCode = 2) as errorCount,
          (sum(statusCode = 2) * 100.0 / count()) as errorRate,
          avg(durationNano / 1e6) as avgLatency,
          quantile(0.95)(durationNano / 1e6) as p95Latency
        FROM signoz_traces.signoz_index_v3
        WHERE timestamp >= parseDateTimeBestEffort('${timeRange.start}')
          AND timestamp <= parseDateTimeBestEffort('${timeRange.end}')
          AND parentSpanID = ''
        GROUP BY serviceName
        HAVING requestCount > 0
        ORDER BY requestCount DESC
      `);

    // Get service dependencies (edges)
    const edgesResult = await executeQuery<{
      source_service: string;
      target_service: string;
      request_count: bigint;
      avg_latency: number;
      error_rate: number;
    }>(`
        SELECT
          p.serviceName as source_service,
          c.serviceName as target_service,
          count() as request_count,
          avg(c.durationNano / 1e6) as avg_latency,
          (sum(c.statusCode = 2) * 100.0 / count()) as error_rate
        FROM signoz_traces.signoz_index_v3 p
        INNER JOIN signoz_traces.signoz_index_v3 c
          ON p.spanID = c.parentSpanID
          AND p.traceID = c.traceID
        WHERE p.timestamp >= parseDateTimeBestEffort('${timeRange.start}')
          AND p.timestamp <= parseDateTimeBestEffort('${timeRange.end}')
          AND p.serviceName != c.serviceName
        GROUP BY p.serviceName, c.serviceName
        HAVING request_count > 10
        ORDER BY request_count DESC
      `);

    const nodes: ServiceNode[] = nodesResult.map((row) => ({
      serviceName: row.serviceName,
      requestCount: Number(row.requestCount),
      errorCount: Number(row.errorCount),
      errorRate: row.errorRate,
      avgLatency: row.avgLatency,
      p95Latency: row.p95Latency,
    }));

    const edges: ServiceEdge[] = edgesResult.map((row) => ({
      source: row.source_service,
      target: row.target_service,
      requestCount: Number(row.request_count),
      avgLatency: row.avg_latency,
      errorRate: row.error_rate,
    }));

    return { nodes, edges, timeRange };
  } catch (error) {
    console.error("Error fetching service map:", error);
    throw error;
  }
}

/**
 * Get RED metrics time series
 */
export async function getREDMetrics(
  timeRange: TimeRange,
  serviceName?: string,
  interval: string = "1m"
): Promise<REDMetrics[]> {
  try {
    const serviceFilter = serviceName ? `AND serviceName = '${serviceName}'` : "";

    // Convert interval format (e.g., "1m" -> "1 MINUTE", "5m" -> "5 MINUTE")
    const clickhouseInterval = convertIntervalToClickHouse(interval);

    const result = await executeQuery<{
      time_bucket: string;
      requestRate: number;
      errorRate: number;
      p50: number;
      p95: number;
      p99: number;
      serviceName?: string;
    }>(`
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${clickhouseInterval}) as time_bucket,
          ${serviceName ? "" : "serviceName,"}
          count() as requestRate,
          (sum(statusCode = 2) * 100.0 / count()) as errorRate,
          quantile(0.50)(durationNano / 1e6) as p50,
          quantile(0.95)(durationNano / 1e6) as p95,
          quantile(0.99)(durationNano / 1e6) as p99
        FROM signoz_traces.signoz_index_v3
        WHERE timestamp >= parseDateTimeBestEffort('${timeRange.start}')
          AND timestamp <= parseDateTimeBestEffort('${timeRange.end}')
          AND parentSpanID = ''
          ${serviceFilter}
        GROUP BY time_bucket${serviceName ? "" : ", serviceName"}
        ORDER BY time_bucket ASC
    `);

    return result.map((row) => ({
      timestamp: row.time_bucket,
      requestRate: row.requestRate,
      errorRate: row.errorRate,
      p50: row.p50,
      p95: row.p95,
      p99: row.p99,
      serviceName: row.serviceName,
    }));
  } catch (error) {
    console.error("Error fetching RED metrics:", error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function convertIntervalToClickHouse(interval: string): string {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) return "1 MINUTE"; // Default fallback

  const [, value, unit] = match;
  const unitMap: Record<string, string> = {
    s: "SECOND",
    m: "MINUTE",
    h: "HOUR",
    d: "DAY",
  };

  return `${value} ${unitMap[unit] || "MINUTE"}`;
}


function transformToTrace(row: {
  traceID: string;
  rootSpanID: string;
  name: string;
  serviceName: string;
  timestamp: string;
  durationNano: bigint;
  statusCode: number;
}): Trace {
  const duration = Number(row.durationNano);
  const startedAt = new Date(row.timestamp).toISOString();
  const endedAt = new Date(new Date(row.timestamp).getTime() + duration / 1e6).toISOString();

  return {
    traceId: row.traceID,
    rootSpanId: row.rootSpanID,
    duration,
    startedAt,
    endedAt,
    status: row.statusCode as SpanStatus,
    serviceNames: [row.serviceName],
    spanCount: 1,
    errorCount: row.statusCode === 2 ? 1 : 0,
    attributes: { name: row.name },
  };
}
