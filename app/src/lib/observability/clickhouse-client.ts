/**
 * ClickHouse Direct Client
 * Bypasses SigNoz Query Service and queries ClickHouse directly via HTTP
 */

import type {
  TraceSearchResponse,
  LogSearchResponse,
  TraceFilters,
  LogFilters,
} from "~/types/observability";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";

/**
 * Execute a ClickHouse query via HTTP interface
 */
async function executeQuery<T = unknown>(query: string): Promise<T[]> {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("database", CLICKHOUSE_DATABASE);

  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
  };

  if (CLICKHOUSE_USER && CLICKHOUSE_PASSWORD) {
    const auth = Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: `${query} FORMAT JSONEachRow`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ClickHouse query failed: ${response.statusText} - ${errorText}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      return [];
    }

    // Parse NDJSON (one JSON object per line)
    const lines = text.trim().split("\n");
    return lines.map(line => JSON.parse(line)) as T[];
  } catch (error) {
    console.error("[clickhouse] Query failed:", error);
    throw error;
  }
}

/**
 * Search for traces in ClickHouse
 */
export async function searchTracesClickHouse(
  filters: TraceFilters
): Promise<TraceSearchResponse> {
  const timeRange = filters.timeRange || {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
    end: new Date().toISOString(),
  };

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  // Build WHERE clause
  // Note: timestamp is DateTime64, so we use parseDateTime64BestEffort for conversion
  const conditions: string[] = [
    `timestamp >= parseDateTime64BestEffort('${timeRange.start}')`,
    `timestamp <= parseDateTime64BestEffort('${timeRange.end}')`,
    "parent_span_id = ''", // Root spans only
  ];

  if (filters.serviceName) {
    const services = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];
    const serviceList = services.map(s => `'${s}'`).join(",");
    conditions.push(`resources_string['service.name'] IN (${serviceList})`);
  }

  if (filters.status !== undefined) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (statuses.length === 1) {
      conditions.push(`status_code = ${statuses[0]}`);
    } else {
      const statusList = statuses.join(",");
      conditions.push(`status_code IN (${statusList})`);
    }
  }

  if (filters.minDuration !== undefined) {
    conditions.push(`duration_nano >= ${filters.minDuration * 1000000}`);
  }

  if (filters.maxDuration !== undefined) {
    conditions.push(`duration_nano <= ${filters.maxDuration * 1000000}`);
  }

  const whereClause = conditions.join(" AND ");

  const query = `
    SELECT
      trace_id AS traceId,
      span_id AS rootSpanId,
      resources_string['service.name'] AS serviceName,
      duration_nano AS duration,
      toUnixTimestamp64Milli(timestamp) AS startedAtMs,
      status_code AS status,
      1 AS spanCount,
      CASE WHEN has_error THEN 1 ELSE 0 END AS errorCount
    FROM signoz_traces.signoz_index_v3
    WHERE ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  interface TraceRow {
    traceId: string;
    rootSpanId: string;
    serviceName: string;
    duration: number;
    startedAtMs: number;
    status: number;
    spanCount: number;
    errorCount: number;
  }

  try {
    const rows = await executeQuery<TraceRow>(query);

    const traces = rows.map(row => {
      // ClickHouse returns large numbers as strings, convert them
      const startedAtMs = Number(row.startedAtMs);
      const durationNs = Number(row.duration);
      const durationMs = durationNs / 1000000; // Convert nanoseconds to milliseconds
      const endedAtMs = startedAtMs + durationMs;

      return {
        traceId: row.traceId,
        rootSpanId: row.rootSpanId,
        serviceNames: [row.serviceName],
        duration: durationNs,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        status: row.status,
        spanCount: row.spanCount,
        errorCount: row.errorCount,
        scRunType: undefined,
        scRunId: undefined,
        scTestName: undefined,
        attributes: {},
      };
    });

    return {
      data: traces,
      total: traces.length,
      services: [],
      runTypes: [],
      limit,
      offset,
      hasMore: traces.length === limit,
    };
  } catch (error) {
    console.error("[clickhouse] Failed to search traces:", error);
    throw error;
  }
}

/**
 * Search for logs in ClickHouse
 */
export async function searchLogsClickHouse(
  filters: LogFilters
): Promise<LogSearchResponse> {
  const timeRange = filters.timeRange || {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
    end: new Date().toISOString(),
  };

  const startNs = BigInt(new Date(timeRange.start).getTime()) * BigInt(1000000);
  const endNs = BigInt(new Date(timeRange.end).getTime()) * BigInt(1000000);

  const limit = filters.limit || 1000;
  const offset = filters.offset || 0;

  // Build WHERE clause
  const conditions: string[] = [
    `timestamp >= ${startNs}`,
    `timestamp <= ${endNs}`,
  ];

  if (filters.serviceName) {
    const services = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];
    const serviceList = services.map(s => `'${s}'`).join(",");
    conditions.push(`resources_string['service.name'] IN (${serviceList})`);
  }

  if (filters.severityLevel) {
    const levels = Array.isArray(filters.severityLevel)
      ? filters.severityLevel
      : [filters.severityLevel];
    const levelList = levels.map(l => `'${l.toUpperCase()}'`).join(",");
    conditions.push(`severity_text IN (${levelList})`);
  }

  if (filters.traceId) {
    conditions.push(`trace_id = '${filters.traceId}'`);
  }

  if (filters.spanId) {
    conditions.push(`span_id = '${filters.spanId}'`);
  }

  if (filters.search) {
    // Escape single quotes in search term
    const escapedSearch = filters.search.replace(/'/g, "\\'");
    conditions.push(`body LIKE '%${escapedSearch}%'`);
  }

  const whereClause = conditions.join(" AND ");

  const query = `
    SELECT
      timestamp,
      observed_timestamp AS observedTimestamp,
      trace_id AS traceId,
      span_id AS spanId,
      severity_text AS severityText,
      severity_number AS severityNumber,
      body,
      attributes_string,
      resources_string
    FROM signoz_logs.distributed_logs_v2
    WHERE ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  interface LogRow {
    timestamp: string;
    observedTimestamp: string;
    traceId: string;
    spanId: string;
    severityText: string;
    severityNumber: number;
    body: string;
    attributes_string: Record<string, string>;
    resources_string: Record<string, string>;
  }

  try {
    const rows = await executeQuery<LogRow>(query);

    const logs = rows.map(row => {
      const attributes = row.attributes_string || {};
      const resourceAttributes = row.resources_string || {};

      // Timestamp is in nanoseconds
      const timestampNs = BigInt(row.timestamp);
      const observedTimestampNs = BigInt(row.observedTimestamp);

      return {
        timestamp: new Date(Number(timestampNs / BigInt(1000000))).toISOString(),
        observedTimestamp: new Date(Number(observedTimestampNs / BigInt(1000000))).toISOString(),
        traceId: row.traceId,
        spanId: row.spanId,
        severityText: row.severityText,
        severityNumber: row.severityNumber,
        body: row.body,
        level: row.severityText.toLowerCase(),
        message: row.body,
        serviceName: resourceAttributes["service.name"] || "",
        attributes,
        resourceAttributes,
        resource: resourceAttributes,
      };
    });

    return {
      data: logs,
      total: logs.length,
      services: [],
      levels: [],
      limit,
      offset,
      hasMore: logs.length === limit,
    };
  } catch (error) {
    console.error("[clickhouse] Failed to search logs:", error);
    throw error;
  }
}
