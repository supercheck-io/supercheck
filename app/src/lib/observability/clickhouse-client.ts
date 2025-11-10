/**
 * ClickHouse Direct Client
 * Bypasses the SigNoz query service and talks to ClickHouse HTTP API directly
 */

import type {
  TraceSearchResponse,
  LogSearchResponse,
  TraceFilters,
  LogFilters,
  TraceWithSpans,
  Span,
  SpanStatus,
  MetricFilters,
  MetricQueryResponse,
  ServiceMetrics,
  EndpointMetrics,
  RunType,
  LogLevel,
} from "~/types/observability";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || "default";

const TRACE_TABLE = "signoz_traces.signoz_index_v3";
const SPAN_TABLE = "signoz_traces.signoz_index_v3"; // Use same table for both traces and spans
const LOG_TABLE = "signoz_logs.distributed_logs_v2";

type TimeRange = { start: string; end: string };

const isRunType = (value: unknown): value is RunType =>
  value === "playwright" ||
  value === "k6" ||
  value === "job" ||
  value === "monitor";

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formatValueList(values: string[]): string {
  return values.map((value) => `'${escapeLiteral(value)}'`).join(", ");
}

function pushAttributeCondition(
  conditions: string[],
  key: string,
  value?: string | string[],
  column = "attributes_string"
) {
  if (!value) return;
  const normalized = (Array.isArray(value) ? value : [value]).filter(Boolean);
  if (!normalized.length) return;

  const attributeKey = escapeLiteral(key);
  if (normalized.length === 1) {
    conditions.push(
      `${column}['${attributeKey}'] = '${escapeLiteral(normalized[0])}'`
    );
  } else {
    conditions.push(
      `${column}['${attributeKey}'] IN (${formatValueList(normalized)})`
    );
  }
}

function parseIntervalToSeconds(interval?: string): number {
  if (!interval) return 60;
  const match = interval.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) return 60;
  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 60 * 60 * 24;
    default:
      return 60;
  }
}

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

function buildTraceConditions(
  timeRange: TimeRange,
  options: {
    serviceName?: string | string[];
    status?: number | number[];
    minDuration?: number;
    maxDuration?: number;
    runType?: string | string[];
    runId?: string;
    testId?: string;
    jobId?: string;
    monitorId?: string;
    projectId?: string;
    organizationId?: string;
    search?: string;
    rootOnly?: boolean;
  }
): string[] {
  const conditions: string[] = [
    `timestamp >= parseDateTime64BestEffort('${timeRange.start}')`,
    `timestamp <= parseDateTime64BestEffort('${timeRange.end}')`,
  ];

  if (options.rootOnly !== false) {
    conditions.push("parent_span_id = ''");
  }

  if (options.serviceName) {
    const services = Array.isArray(options.serviceName)
      ? options.serviceName
      : [options.serviceName];
    conditions.push(
      `resources_string['service.name'] IN (${formatValueList(services)})`
    );
  }

  if (options.status !== undefined) {
    const statuses = Array.isArray(options.status)
      ? options.status
      : [options.status];
    conditions.push(
      statuses.length === 1
        ? `status_code = ${statuses[0]}`
        : `status_code IN (${statuses.join(",")})`
    );
  }

  if (options.minDuration !== undefined) {
    conditions.push(`duration_nano >= ${options.minDuration * 1_000_000}`);
  }

  if (options.maxDuration !== undefined) {
    conditions.push(`duration_nano <= ${options.maxDuration * 1_000_000}`);
  }

  pushAttributeCondition(conditions, "sc.run_type", options.runType);
  pushAttributeCondition(conditions, "sc.run_id", options.runId);
  pushAttributeCondition(conditions, "sc.test_id", options.testId);
  pushAttributeCondition(conditions, "sc.job_id", options.jobId);
  pushAttributeCondition(conditions, "sc.monitor_id", options.monitorId);
  pushAttributeCondition(conditions, "sc.project_id", options.projectId);
  pushAttributeCondition(conditions, "sc.organization_id", options.organizationId);

  if (options.search) {
    const query = escapeLiteral(options.search);
    conditions.push(
      `(name ILIKE '%${query}%' OR attributes_string['sc.test_name'] ILIKE '%${query}%' OR trace_id ILIKE '%${query}%')`
    );
  }

  return conditions;
}

// -----------------------------------------------------------------------------
// Trace Queries
// -----------------------------------------------------------------------------

export async function searchTracesClickHouse(
  filters: TraceFilters
): Promise<TraceSearchResponse> {
  const timeRange = filters.timeRange || {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  };

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const conditions = buildTraceConditions(timeRange, {
    serviceName: filters.serviceName,
    status: filters.status,
    minDuration: filters.minDuration,
    maxDuration: filters.maxDuration,
    runType: filters.runType,
    runId: filters.runId,
    testId: filters.testId,
    jobId: filters.jobId,
    monitorId: filters.monitorId,
    projectId: filters.projectId,
    organizationId: filters.organizationId,
    search: filters.search,
    rootOnly: true,
  });

  const whereClause = conditions.join(" AND ");

  const query = `
    SELECT
      trace_id AS traceId,
      span_id AS rootSpanId,
      resources_string['service.name'] AS serviceName,
      duration_nano AS duration,
      toUnixTimestamp64Milli(timestamp) AS startedAtMs,
      status_code AS status,
      CASE WHEN has_error THEN 1 ELSE 0 END AS errorCount,
      attributes_string['sc.run_type'] AS scRunType,
      attributes_string['sc.run_id'] AS scRunId,
      attributes_string['sc.test_name'] AS scTestName,
      attributes_string['sc.job_name'] AS scJobName,
      attributes_string['sc.monitor_name'] AS scMonitorName,
      attributes_string['sc.job_type'] AS scJobType,
      attributes_string['sc.test_type'] AS scTestType
    FROM ${TRACE_TABLE}
    WHERE ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  interface TraceRow {
    traceId: string;
    rootSpanId: string;
    serviceName: string;
    duration: string | number;
    startedAtMs: string | number;
    status: number;
    errorCount: number;
    scRunType?: string;
    scRunId?: string;
    scTestName?: string;
    scJobName?: string;
    scMonitorName?: string;
    scJobType?: string;
    scTestType?: string;
  }

  const rows = await executeQuery<TraceRow>(query);
  const serviceSet = new Set<string>();
  const runTypeSet = new Set<string>();

  const traces = rows.map((row) => {
    if (row.serviceName) serviceSet.add(row.serviceName);
    if (row.scRunType && isRunType(row.scRunType)) {
      runTypeSet.add(row.scRunType);
    }

    const startedAt = Number(row.startedAtMs);
    const duration = Number(row.duration);
    const endedAt = startedAt + duration / 1_000_000;
    const scRunType = row.scRunType && isRunType(row.scRunType) ? row.scRunType : undefined;

    return {
      traceId: row.traceId,
      rootSpanId: row.rootSpanId,
      serviceNames: row.serviceName ? [row.serviceName] : [],
      duration,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      status: Number(row.status) as SpanStatus,
      spanCount: 1,
      errorCount: row.errorCount,
      scRunType,
      scRunId: row.scRunId || undefined,
      scTestName: row.scTestName || undefined,
      scJobName: row.scJobName || undefined,
      scMonitorName: row.scMonitorName || undefined,
      scJobType: row.scJobType as 'playwright' | 'k6' | undefined,
      scTestType: row.scTestType || undefined,
      attributes: {},
    };
  });

  return {
    data: traces,
    total: traces.length,
    services: Array.from(serviceSet),
    runTypes: Array.from(runTypeSet).filter(Boolean) as RunType[],
    limit,
    offset,
    hasMore: traces.length === limit,
  };
}

export async function getTraceWithSpansClickHouse(
  traceId: string
): Promise<TraceWithSpans | null> {
  if (!traceId) return null;

  const spansQuery = `
    SELECT
      trace_id AS traceId,
      span_id AS spanId,
      parent_span_id AS parentSpanId,
      resources_string['service.name'] AS serviceName,
      name,
      kind,
      duration_nano AS duration,
      status_code AS statusCode,
      status_message AS statusMessage,
      toUnixTimestamp64Milli(timestamp) AS startTimeMs,
      attributes_string AS attributes,
      resources_string AS resources
    FROM ${SPAN_TABLE}
    WHERE trace_id = '${escapeLiteral(traceId)}'
    ORDER BY timestamp ASC
  `;

  interface SpanRow {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    serviceName?: string;
    name: string;
    kind?: number;
    duration: string | number;
    statusCode?: number;
    statusMessage?: string;
    startTimeMs: string | number;
    attributes?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  }

  const rows = await executeQuery<SpanRow>(spansQuery);

  if (!rows.length) {
    return null;
  }

  const spans: Span[] = rows.map((row) => {
    const startTimeMs = Number(row.startTimeMs);
    const durationNs = Number(row.duration);
    const endTimeMs = startTimeMs + durationNs / 1_000_000;
    const attributes = row.attributes || {};
    const resourceAttributes = row.resources || {};

    return {
      spanId: row.spanId,
      traceId: row.traceId,
      parentSpanId: row.parentSpanId || undefined,
      name: row.name,
      serviceName:
        row.serviceName ||
        (resourceAttributes["service.name"] as string) ||
        "unknown",
      kind: (row.kind ?? 0) as Span["kind"],
      startTime: new Date(startTimeMs).toISOString(),
      endTime: new Date(endTimeMs).toISOString(),
      duration: durationNs,
      statusCode: (row.statusCode ?? 0) as Span["statusCode"],
      statusMessage: row.statusMessage || undefined,
      attributes,
      resourceAttributes,
      events: [],
      links: [],
    };
  });

  const serviceNames = new Set<string>();
  spans.forEach((span) => {
    if (span.serviceName) serviceNames.add(span.serviceName);
  });

  const rootSpan = spans.find((span) => !span.parentSpanId) ?? spans[0];
  const startMs = Math.min(...spans.map((span) => new Date(span.startTime).getTime()));
  const endMs = Math.max(...spans.map((span) => new Date(span.endTime).getTime()));
  const errorCount = spans.filter((span) => span.statusCode === 2).length;

  const scRunTypeAttr = rootSpan.attributes["sc.run_type"];
  const scRunTypeValue =
    typeof scRunTypeAttr === "string" && isRunType(scRunTypeAttr)
      ? scRunTypeAttr
      : undefined;

  return {
    traceId,
    rootSpanId: rootSpan.spanId,
    duration: Math.max(endMs - startMs, 0) * 1_000_000,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    status: rootSpan.statusCode,
    serviceNames: Array.from(serviceNames),
    spanCount: spans.length,
    errorCount,
    scOrgId: rootSpan.attributes["sc.organization_id"] as string | undefined,
    scProjectId: rootSpan.attributes["sc.project_id"] as string | undefined,
    scRunId: rootSpan.attributes["sc.run_id"] as string | undefined,
    scRunType: scRunTypeValue,
    scTestName: rootSpan.attributes["sc.test_name"] as string | undefined,
    scJobName: rootSpan.attributes["sc.job_name"] as string | undefined,
    scMonitorName: rootSpan.attributes["sc.monitor_name"] as string | undefined,
    scJobType: rootSpan.attributes["sc.job_type"] as 'playwright' | 'k6' | undefined,
    scTestType: rootSpan.attributes["sc.test_type"] as string | undefined,
    attributes: rootSpan.attributes,
    spans,
  };
}

export async function getTraceForRunClickHouse(
  runId: string
): Promise<TraceWithSpans | null> {
  if (!runId) return null;

  const query = `
    SELECT trace_id AS traceId
    FROM ${TRACE_TABLE}
    WHERE parent_span_id = ''
      AND attributes_string['sc.run_id'] = '${escapeLiteral(runId)}'
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  const rows = await executeQuery<{ traceId: string }>(query);
  const traceId = rows[0]?.traceId;
  if (!traceId) return null;

  return getTraceWithSpansClickHouse(traceId);
}

// -----------------------------------------------------------------------------
// Log Queries
// -----------------------------------------------------------------------------

export async function searchLogsClickHouse(
  filters: LogFilters
): Promise<LogSearchResponse> {
  const timeRange = filters.timeRange || {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  };

  const startNs = BigInt(new Date(timeRange.start).getTime()) * BigInt(1_000_000);
  const endNs = BigInt(new Date(timeRange.end).getTime()) * BigInt(1_000_000);

  const limit = filters.limit || 1000;
  const offset = filters.offset || 0;

  const conditions: string[] = [
    `timestamp >= ${startNs}`,
    `timestamp <= ${endNs}`,
  ];

  if (filters.serviceName) {
    const services = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];
    conditions.push(
      `resources_string['service.name'] IN (${formatValueList(services)})`
    );
  }

  if (filters.severityLevel) {
    const levels = Array.isArray(filters.severityLevel)
      ? filters.severityLevel
      : [filters.severityLevel];
    conditions.push(
      `severity_text IN (${formatValueList(levels.map((level) => level.toUpperCase()))})`
    );
  }

  if (filters.traceId) {
    conditions.push(`trace_id = '${escapeLiteral(filters.traceId)}'`);
  }

  if (filters.spanId) {
    conditions.push(`span_id = '${escapeLiteral(filters.spanId)}'`);
  }

  pushAttributeCondition(conditions, "sc.run_id", filters.runId);
  pushAttributeCondition(conditions, "sc.project_id", filters.projectId);
  pushAttributeCondition(conditions, "sc.organization_id", filters.organizationId);
  pushAttributeCondition(conditions, "sc.run_type", filters.runType);

  if (filters.search) {
    const query = escapeLiteral(filters.search);
    conditions.push(`body ILIKE '%${query}%'`);
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
      attributes_string AS attributes,
      resources_string AS resources
    FROM ${LOG_TABLE}
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
    attributes?: Record<string, unknown>;
    resources?: Record<string, unknown>;
  }

  const rows = await executeQuery<LogRow>(query);

  const logs = rows.map((row) => {
    const timestampNs = BigInt(row.timestamp);
    const observedNs = BigInt(row.observedTimestamp);
    const resourceAttributes = row.resources || {};
    const severityText = (row.severityText || "INFO").toUpperCase();
    const severityLevel =
      severityText === "TRACE" ||
      severityText === "DEBUG" ||
      severityText === "INFO" ||
      severityText === "WARN" ||
      severityText === "ERROR" ||
      severityText === "FATAL"
        ? (severityText as LogLevel)
        : ("INFO" as LogLevel);

    return {
      timestamp: new Date(Number(timestampNs / BigInt(1_000_000))).toISOString(),
      observedTimestamp: new Date(
        Number(observedNs / BigInt(1_000_000))
      ).toISOString(),
      traceId: row.traceId,
      spanId: row.spanId,
      severityText: severityLevel,
      severityNumber: row.severityNumber,
      body: row.body,
      level: severityLevel.toLowerCase(),
      message: row.body,
      serviceName: (resourceAttributes["service.name"] as string) || "",
      attributes: row.attributes || {},
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
}

// -----------------------------------------------------------------------------
// Metrics (aggregated from traces)
// -----------------------------------------------------------------------------

export async function queryMetricsClickHouse(
  filters: MetricFilters
): Promise<MetricQueryResponse> {
  const timeRange = filters.timeRange || {
    start: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  };

  const intervalSeconds = parseIntervalToSeconds(filters.interval || "1m");

  const conditions = buildTraceConditions(timeRange, {
    serviceName: filters.serviceName,
    runType: filters.runType,
    rootOnly: true,
  });

  const whereClause = conditions.join(" AND ");
  const aggregation = filters.aggregation || "p95";
  const valueExpr = "duration_nano / 1000000";

  const aggExpr =
    aggregation === "avg"
      ? `avg(${valueExpr})`
      : aggregation === "sum"
      ? `sum(${valueExpr})`
      : aggregation === "min"
      ? `min(${valueExpr})`
      : aggregation === "max"
      ? `max(${valueExpr})`
      : aggregation === "p50"
      ? `quantile(0.50)(${valueExpr})`
      : aggregation === "p99"
      ? `quantile(0.99)(${valueExpr})`
      : `quantile(0.95)(${valueExpr})`;

  const query = `
    SELECT
      toUnixTimestamp64Milli(
        toStartOfInterval(timestamp, INTERVAL ${intervalSeconds} second)
      ) AS bucketMs,
      ${aggExpr} AS value
    FROM ${TRACE_TABLE}
    WHERE ${whereClause}
    GROUP BY bucketMs
    ORDER BY bucketMs
  `;

  const rows = await executeQuery<{ bucketMs: string | number; value: number }>(
    query
  );

  return {
    metrics: [
      {
        name:
          (Array.isArray(filters.metricName)
            ? filters.metricName[0]
            : filters.metricName) || "duration_ms",
        points: rows.map((row) => ({
          timestamp: new Date(Number(row.bucketMs)).toISOString(),
          value: Number(row.value),
          seriesKey: "duration",
        })),
        labels: {},
      },
    ],
    timeRange,
  };
}

export async function getServiceMetricsClickHouse(
  serviceName: string,
  timeRange: TimeRange,
  projectId?: string,
  organizationId?: string
): Promise<ServiceMetrics> {
  const conditions = buildTraceConditions(timeRange, {
    serviceName,
    projectId,
    organizationId,
    rootOnly: true,
  });

  const whereClause = conditions.join(" AND ");

  const query = `
    SELECT
      count() AS requestCount,
      countIf(status_code = 2) AS errorCount,
      avg(duration_nano / 1000000) AS avgLatency,
      quantile(0.50)(duration_nano / 1000000) AS p50Latency,
      quantile(0.95)(duration_nano / 1000000) AS p95Latency,
      quantile(0.99)(duration_nano / 1000000) AS p99Latency
    FROM ${TRACE_TABLE}
    WHERE ${whereClause}
  `;

  const [row] = await executeQuery<{
    requestCount?: number;
    errorCount?: number;
    avgLatency?: number;
    p50Latency?: number;
    p95Latency?: number;
    p99Latency?: number;
  }>(query);

  const requestCount = Number(row?.requestCount || 0);
  const errorCount = Number(row?.errorCount || 0);
  const durationSeconds =
    (new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime()) /
    1000;

  return {
    serviceName,
    requestCount,
    errorCount,
    errorRate: requestCount ? (errorCount / requestCount) * 100 : 0,
    p50Latency: Number(row?.p50Latency || 0),
    p95Latency: Number(row?.p95Latency || 0),
    p99Latency: Number(row?.p99Latency || 0),
    avgLatency: Number(row?.avgLatency || 0),
    throughput:
      durationSeconds > 0 ? requestCount / durationSeconds : requestCount,
  };
}

export async function getEndpointMetricsClickHouse(
  serviceName: string,
  timeRange: TimeRange,
  projectId?: string,
  organizationId?: string
): Promise<EndpointMetrics[]> {
  const conditions = buildTraceConditions(timeRange, {
    serviceName,
    projectId,
    organizationId,
    rootOnly: true,
  });
  conditions.push(`attributes_string['http.route'] != ''`);

  const whereClause = conditions.join(" AND ");

  const query = `
    SELECT
      attributes_string['http.route'] AS route,
      attributes_string['http.method'] AS method,
      count() AS requestCount,
      countIf(status_code = 2) AS errorCount,
      quantile(0.95)(duration_nano / 1000000) AS p95Latency
    FROM ${TRACE_TABLE}
    WHERE ${whereClause}
    GROUP BY route, method
    ORDER BY requestCount DESC
    LIMIT 25
  `;

  const rows = await executeQuery<{
    route?: string;
    method?: string;
    requestCount?: number;
    errorCount?: number;
    p95Latency?: number;
  }>(query);

  const durationSeconds =
    (new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime()) /
    1000;

  return rows.map((row) => {
    const requestCount = Number(row.requestCount || 0);
    const errorCount = Number(row.errorCount || 0);

    return {
      endpoint: row.route || "unknown",
      httpMethod: row.method || undefined,
      serviceName,
      requestCount,
      errorCount,
      errorRate: requestCount ? (errorCount / requestCount) * 100 : 0,
      p50Latency: 0,
      p95Latency: Number(row.p95Latency || 0),
      p99Latency: 0,
      avgLatency: 0,
      throughput:
        durationSeconds > 0 ? requestCount / durationSeconds : requestCount,
    };
  });
}
