/**
 * Observability API Client
 * Handles communication with SigNoz Query Service and provides utilities
 * for processing observability data
 */

import type {

  TraceWithSpans,
  Span,
  Log,

  TraceFilters,
  LogFilters,
  MetricFilters,
  TraceSearchResponse,
  LogSearchResponse,
  MetricQueryResponse,
  SpanTreeNode,
  ServiceMetrics,
  EndpointMetrics,
  FlamegraphNode,
} from "~/types/observability";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SIGNOZ_URL = process.env.SIGNOZ_URL || "http://localhost:8080";
const API_TIMEOUT = 30000; // 30 seconds
const SIGNOZ_DISABLE_AUTH = process.env.SIGNOZ_DISABLE_AUTH === "true";
const SIGNOZ_API_KEY = process.env.SIGNOZ_API_KEY;
const SIGNOZ_BEARER_TOKEN = process.env.SIGNOZ_BEARER_TOKEN;

/**
 * Build auth headers for SigNoz API requests
 */
function buildAuthHeaders(): Record<string, string> {
  if (SIGNOZ_DISABLE_AUTH) {
    return {};
  }

  const headers: Record<string, string> = {};

  // Priority: API Key > Bearer Token
  if (SIGNOZ_API_KEY) {
    headers["SIGNOZ-API-KEY"] = SIGNOZ_API_KEY;
  } else if (SIGNOZ_BEARER_TOKEN) {
    headers["Authorization"] = `Bearer ${SIGNOZ_BEARER_TOKEN}`;
  }

  return headers;
}

/**
 * Build query string from filters object
 */
function buildQueryString(filters: Record<string, unknown>): string {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, String(v)));
      } else if (typeof value === "object") {
        params.append(key, JSON.stringify(value));
      } else {
        params.append(key, String(value));
      }
    }
  });

  return params.toString();
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = API_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Merge auth headers with provided headers
  const authHeaders = buildAuthHeaders();
  const headers = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Transform SigNoz traces API response to our format
 */
function transformTracesResponse(signozResponse: any): TraceSearchResponse {
  // SigNoz returns data in result.data.table format for list queries
  const records = signozResponse?.result?.[0]?.list || [];

  const traces = records.map((record: any) => ({
    traceId: record.traceID || record.trace_id || "",
    rootSpanId: record.spanID || record.span_id || "",
    serviceNames: record.serviceName ? [record.serviceName] : [],
    duration: record.durationNano || 0,
    startedAt: new Date(record.timestamp / 1000000).toISOString(), // Convert from nanoseconds
    endedAt: new Date((record.timestamp + record.durationNano) / 1000000).toISOString(),
    status: record.hasError ? 2 : 1,
    spanCount: 1, // SigNoz list view doesn't provide this, will be updated when fetching full trace
    errorCount: record.hasError ? 1 : 0,
    scRunType: record["sc.run_type"],
    scRunId: record["sc.run_id"],
    scTestName: record["sc.test_name"],
    attributes: {},
  }));

  return {
    data: traces,
    total: records.length,
    services: [],
    runTypes: [],
    limit: 100,
    offset: 0,
    hasMore: false,
  };
}

/**
 * Transform SigNoz logs API response to our format
 */
function transformLogsResponse(signozResponse: any): LogSearchResponse {
  const records = signozResponse?.result?.[0]?.list || [];

  const logs = records.map((record: any) => ({
    timestamp: new Date(record.timestamp / 1000000).toISOString(),
    traceId: record.trace_id || record.traceId,
    spanId: record.span_id || record.spanId,
    level: record.severity_text || record.level || "info",
    message: record.body || record.message || "",
    serviceName: record.service_name || record.serviceName || "",
    attributes: record.attributes_string || record.attributes || {},
    resource: record.resources_string || record.resource || {},
  }));

  return {
    data: logs,
    total: records.length,
    services: [],
    levels: [],
    limit: 1000,
    offset: 0,
    hasMore: false,
  };
}

/**
 * Transform SigNoz metrics API response to our format
 */
function transformMetricsResponse(signozResponse: any): MetricQueryResponse {
  const series = signozResponse?.result?.[0]?.series || [];

  const metrics = series.map((serie: any) => ({
    metric: serie.labels || {},
    values: serie.values || [],
  }));

  return {
    metrics: metrics.map((m: any) => ({
      name: m.metric?.__name__ || "unknown",
      points: m.values?.map((v: any) => ({
        timestamp: new Date(v[0] * 1000).toISOString(),
        value: parseFloat(v[1]),
        seriesKey: JSON.stringify(m.metric),
      })) || [],
      labels: m.metric || {},
    })),
    timeRange: {
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    },
  };
}

// ============================================================================
// TRACE APIs
// ============================================================================

/**
 * Search for traces based on filters
 */
export async function searchTraces(
  filters: TraceFilters
): Promise<TraceSearchResponse> {
  const url = `${SIGNOZ_URL}/api/v3/query_range`;

  // Convert filters to SigNoz query builder format
  const filterItems: any[] = [];

  if (filters.serviceName) {
    const serviceNames = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];

    if (serviceNames.length === 1) {
      filterItems.push({
        key: {
          key: "serviceName",
          dataType: "string",
          type: "tag",
          isColumn: true,
        },
        op: "=",
        value: serviceNames[0],
      });
    } else if (serviceNames.length > 1) {
      filterItems.push({
        key: {
          key: "serviceName",
          dataType: "string",
          type: "tag",
          isColumn: true,
        },
        op: "in",
        value: serviceNames,
      });
    }
  }

  if (filters.runType) {
    filterItems.push({
      key: {
        key: "sc.run_type",
        dataType: "string",
        type: "tag",
        isColumn: false,
      },
      op: "=",
      value: filters.runType,
    });
  }

  if (filters.runId) {
    filterItems.push({
      key: {
        key: "sc.run_id",
        dataType: "string",
        type: "tag",
        isColumn: false,
      },
      op: "=",
      value: filters.runId,
    });
  }

  if (filters.status !== undefined) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    const hasError = statuses.includes(2);
    filterItems.push({
      key: {
        key: "hasError",
        dataType: "bool",
        type: "tag",
        isColumn: true,
      },
      op: "=",
      value: hasError ? "true" : "false",
    });
  }

  const timeRange = filters.timeRange || getTimeRangePreset("last_1h");
  const start = new Date(timeRange.start).getTime();
  const end = new Date(timeRange.end).getTime();

  const payload = {
    start,
    end,
    step: 60,
    variables: {},
    compositeQuery: {
      queryType: "builder",
      panelType: "list",
      builderQueries: {
        A: {
          dataSource: "traces",
          queryName: "A",
          aggregateOperator: "noop",
          aggregateAttribute: {},
          filters: {
            items: filterItems,
            op: "AND",
          },
          expression: "A",
          disabled: false,
          having: [],
          stepInterval: 60,
          limit: filters.limit || 100,
          offset: filters.offset || 0,
          orderBy: [
            {
              columnName: "timestamp",
              order: "desc",
            },
          ],
          groupBy: [],
          legend: "",
          reduceTo: "sum",
        },
      },
    },
  };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to search traces: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Transform SigNoz response to our expected format
  return transformTracesResponse(data);
}

/**
 * Get a specific trace by ID with all its spans
 */
export async function getTrace(traceId: string): Promise<TraceWithSpans> {
  const url = `${SIGNOZ_URL}/api/v1/traces/${traceId}`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    // If v1 endpoint doesn't exist, try v3 with filter
    const traceSearchResult = await searchTraces({
      timeRange: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      },
      limit: 1,
    });

    if (traceSearchResult.data.length === 0) {
      throw new Error(`Trace not found: ${traceId}`);
    }

    const trace = traceSearchResult.data[0];

    // For now, return a minimal TraceWithSpans
    // In production, we'd need to query spans from ClickHouse directly
    return {
      traceId: trace.traceId,
      rootSpanId: trace.traceId,
      serviceNames: trace.serviceNames,
      duration: trace.duration,
      startedAt: trace.startedAt,
      endedAt: trace.startedAt,
      status: trace.errorCount > 0 ? 2 : 1,
      spanCount: trace.spanCount,
      errorCount: trace.errorCount,
      spans: [], // Would need separate endpoint to get all spans
      scRunType: trace.scRunType,
      scRunId: trace.scRunId,
      scTestName: trace.scTestName,
      attributes: {},
    };
  }

  const data = await response.json();
  return data;
}

/**
 * Get trace by run ID (SuperCheck-specific)
 */
export async function getTraceByRunId(runId: string): Promise<TraceWithSpans | null> {
  const filters: TraceFilters = {
    runId,
    timeRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    limit: 1,
  };

  const result = await searchTraces(filters);

  if (result.data.length === 0) {
    return null;
  }

  return getTrace(result.data[0].traceId);
}

// ============================================================================
// LOG APIs
// ============================================================================

/**
 * Search for logs based on filters
 */
export async function searchLogs(filters: LogFilters): Promise<LogSearchResponse> {
  const url = `${SIGNOZ_URL}/api/v3/query_range`;

  // Convert filters to SigNoz query builder format
  const filterItems: any[] = [];

  if (filters.serviceName) {
    const serviceNames = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];

    if (serviceNames.length === 1) {
      filterItems.push({
        key: {
          key: "service_name",
          dataType: "string",
          type: "resource",
          isColumn: false,
        },
        op: "=",
        value: serviceNames[0],
      });
    } else if (serviceNames.length > 1) {
      filterItems.push({
        key: {
          key: "service_name",
          dataType: "string",
          type: "resource",
          isColumn: false,
        },
        op: "in",
        value: serviceNames,
      });
    }
  }

  if (filters.severityLevel) {
    const levels = Array.isArray(filters.severityLevel)
      ? filters.severityLevel
      : [filters.severityLevel];

    levels.forEach((level) => {
      filterItems.push({
        key: {
          key: "severity_text",
          dataType: "string",
          type: "tag",
          isColumn: true,
        },
        op: "=",
        value: level.toUpperCase(),
      });
    });
  }

  if (filters.traceId) {
    filterItems.push({
      key: {
        key: "trace_id",
        dataType: "string",
        type: "tag",
        isColumn: true,
      },
      op: "=",
      value: filters.traceId,
    });
  }

  if (filters.spanId) {
    filterItems.push({
      key: {
        key: "span_id",
        dataType: "string",
        type: "tag",
        isColumn: true,
      },
      op: "=",
      value: filters.spanId,
    });
  }

  if (filters.search) {
    filterItems.push({
      key: {
        key: "body",
        dataType: "string",
        type: "tag",
        isColumn: true,
      },
      op: "contains",
      value: filters.search,
    });
  }

  const timeRange = filters.timeRange || getTimeRangePreset("last_1h");
  const start = new Date(timeRange.start).getTime();
  const end = new Date(timeRange.end).getTime();

  const payload = {
    start,
    end,
    step: 60,
    variables: {},
    compositeQuery: {
      queryType: "builder",
      panelType: "list",
      builderQueries: {
        A: {
          dataSource: "logs",
          queryName: "A",
          aggregateOperator: "noop",
          aggregateAttribute: {},
          filters: {
            items: filterItems,
            op: "AND",
          },
          expression: "A",
          disabled: false,
          having: [],
          stepInterval: 60,
          limit: filters.limit || 1000,
          offset: filters.offset || 0,
          orderBy: [
            {
              columnName: "timestamp",
              order: "desc",
            },
          ],
          groupBy: [],
          legend: "",
          reduceTo: "sum",
        },
      },
    },
  };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to search logs: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Transform SigNoz response to our expected format
  return transformLogsResponse(data);
}

/**
 * Get logs for a specific trace
 */
export async function getLogsForTrace(traceId: string): Promise<Log[]> {
  const filters: LogFilters = {
    traceId,
    timeRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    limit: 10000,
  };

  const result = await searchLogs(filters);
  return result.data;
}

/**
 * Get logs for a specific span
 */
export async function getLogsForSpan(spanId: string): Promise<Log[]> {
  const filters: LogFilters = {
    spanId,
    timeRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    limit: 1000,
  };

  const result = await searchLogs(filters);
  return result.data;
}

// ============================================================================
// METRIC APIs
// ============================================================================

/**
 * Query time series metrics
 */
export async function queryMetrics(
  filters: MetricFilters
): Promise<MetricQueryResponse> {
  const url = `${SIGNOZ_URL}/api/v3/query_range`;

  // Convert filters to SigNoz query builder format
  const filterItems: any[] = [];

  if (filters.serviceName) {
    const serviceNames = Array.isArray(filters.serviceName)
      ? filters.serviceName
      : [filters.serviceName];

    if (serviceNames.length === 1) {
      filterItems.push({
        key: {
          key: "service_name",
          dataType: "string",
          type: "tag",
          isColumn: false,
        },
        op: "=",
        value: serviceNames[0],
      });
    } else if (serviceNames.length > 1) {
      filterItems.push({
        key: {
          key: "service_name",
          dataType: "string",
          type: "tag",
          isColumn: false,
        },
        op: "in",
        value: serviceNames,
      });
    }
  }

  if (filters.metricName) {
    filterItems.push({
      key: {
        key: "__name__",
        dataType: "string",
        type: "tag",
        isColumn: true,
      },
      op: "=",
      value: filters.metricName,
    });
  }

  const timeRange = filters.timeRange || getTimeRangePreset("last_1h");
  const start = new Date(timeRange.start).getTime();
  const end = new Date(timeRange.end).getTime();

  const payload = {
    start,
    end,
    step: 60,
    variables: {},
    compositeQuery: {
      queryType: "builder",
      panelType: "graph",
      builderQueries: {
        A: {
          dataSource: "metrics",
          queryName: "A",
          aggregateOperator: filters.aggregation || "avg",
          aggregateAttribute: {
            key: filters.metricName || "signoz_latency_bucket",
            dataType: "float64",
            type: "tag",
            isColumn: true,
          },
          filters: {
            items: filterItems,
            op: "AND",
          },
          expression: "A",
          disabled: false,
          having: [],
          stepInterval: 60,
          limit: null,
          orderBy: [],
          groupBy: filters.groupBy?.map((key) => ({
            key,
            dataType: "string",
            type: "tag",
            isColumn: false,
          })) || [],
          legend: "",
          reduceTo: filters.aggregation || "avg",
        },
      },
    },
  };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to query metrics: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Transform SigNoz response to our expected format
  return transformMetricsResponse(data);
}

/**
 * Get service metrics (latency, error rate, throughput)
 */
export async function getServiceMetrics(
  serviceName: string,
  timeRange: { start: string; end: string }
): Promise<ServiceMetrics> {
  const filters: MetricFilters = {
    serviceName,
    timeRange,
    aggregation: "p95",
  };

  // Query metrics (result currently unused, mock data below)
  await queryMetrics(filters);

  // Process and aggregate the metrics
  // This is a simplified example - actual implementation would parse SigNoz response
  const metrics: ServiceMetrics = {
    serviceName,
    requestCount: 0,
    errorCount: 0,
    errorRate: 0,
    p50Latency: 0,
    p95Latency: 0,
    p99Latency: 0,
    avgLatency: 0,
    throughput: 0,
  };

  return metrics;
}

/**
 * Get endpoint metrics grouped by endpoint
 */
export async function getEndpointMetrics(
  serviceName: string,
  timeRange: { start: string; end: string }
): Promise<EndpointMetrics[]> {
  const filters: MetricFilters = {
    serviceName,
    timeRange,
    groupBy: ["http.route"],
    aggregation: "p95",
  };

  // Query metrics (result currently unused, mock data below)
  await queryMetrics(filters);

  // Process and group by endpoint
  const endpoints: EndpointMetrics[] = [];

  return endpoints;
}

// ============================================================================
// SPAN TREE UTILITIES
// ============================================================================

/**
 * Build a hierarchical tree from flat span list
 */
export function buildSpanTree(spans: Span[]): SpanTreeNode[] {
  const spanMap = new Map<string, SpanTreeNode>();
  const rootSpans: SpanTreeNode[] = [];

  // First pass: create all nodes
  spans.forEach((span) => {
    spanMap.set(span.spanId, {
      ...span,
      children: [],
      depth: 0,
      selfTime: span.duration,
    });
  });

  // Second pass: build tree structure and calculate self time
  spans.forEach((span) => {
    const node = spanMap.get(span.spanId)!;

    if (span.parentSpanId) {
      const parent = spanMap.get(span.parentSpanId);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
        // Subtract child duration from parent's self time
        parent.selfTime = Math.max(0, parent.selfTime - span.duration);
      } else {
        // Parent not found, treat as root
        rootSpans.push(node);
      }
    } else {
      rootSpans.push(node);
    }
  });

  // Sort children by start time
  const sortChildren = (node: SpanTreeNode) => {
    node.children.sort((a, b) => {
      const aTime = new Date(a.startTime).getTime();
      const bTime = new Date(b.startTime).getTime();
      return aTime - bTime;
    });
    node.children.forEach(sortChildren);
  };

  rootSpans.forEach(sortChildren);

  return rootSpans;
}

/**
 * Flatten span tree to a list with depth information
 */
export function flattenSpanTree(tree: SpanTreeNode[]): SpanTreeNode[] {
  const flattened: SpanTreeNode[] = [];

  const traverse = (node: SpanTreeNode) => {
    flattened.push(node);
    node.children.forEach(traverse);
  };

  tree.forEach(traverse);
  return flattened;
}

/**
 * Find critical path in span tree (longest path from root to leaf)
 */
export function findCriticalPath(tree: SpanTreeNode[]): SpanTreeNode[] {
  let longestPath: SpanTreeNode[] = [];
  let maxDuration = 0;

  const traverse = (node: SpanTreeNode, path: SpanTreeNode[]) => {
    const currentPath = [...path, node];

    if (node.children.length === 0) {
      // Leaf node - check if this path is longer
      const totalDuration = currentPath.reduce((sum, n) => sum + n.duration, 0);
      if (totalDuration > maxDuration) {
        maxDuration = totalDuration;
        longestPath = currentPath;
      }
    } else {
      // Recurse on children
      node.children.forEach((child) => traverse(child, currentPath));
    }
  };

  tree.forEach((root) => traverse(root, []));
  return longestPath;
}

// ============================================================================
// FLAMEGRAPH UTILITIES
// ============================================================================

/**
 * Convert span tree to flamegraph format
 */
export function buildFlamegraph(spans: Span[]): FlamegraphNode {
  const tree = buildSpanTree(spans);

  // Find root span (usually the one with no parent)
  const rootSpan = tree[0];

  if (!rootSpan) {
    return {
      name: "Empty",
      value: 0,
      children: [],
      span: spans[0],
    };
  }

  const convertToFlamegraph = (node: SpanTreeNode): FlamegraphNode => {
    return {
      name: node.name,
      value: node.duration / 1_000_000, // Convert to milliseconds
      children: node.children.map(convertToFlamegraph),
      span: node,
    };
  };

  return convertToFlamegraph(rootSpan);
}

// ============================================================================
// ATTRIBUTE UTILITIES
// ============================================================================

/**
 * Extract SuperCheck-specific attributes from span
 */
export function extractSuperCheckAttributes(span: Span) {
  return {
    orgId: span.attributes["sc.org_id"] as string | undefined,
    projectId: span.attributes["sc.project_id"] as string | undefined,
    runId: span.attributes["sc.run_id"] as string | undefined,
    runType: span.attributes["sc.run_type"] as string | undefined,
    testId: span.attributes["sc.test_id"] as string | undefined,
    testName: span.attributes["sc.test_name"] as string | undefined,
    jobId: span.attributes["sc.job_id"] as string | undefined,
    jobName: span.attributes["sc.job_name"] as string | undefined,
    monitorId: span.attributes["sc.monitor_id"] as string | undefined,
    monitorType: span.attributes["sc.monitor_type"] as string | undefined,
    workerId: span.attributes["sc.worker_id"] as string | undefined,
    region: span.attributes["sc.region"] as string | undefined,
    artifactsUrl: span.attributes["sc.artifacts_url"] as string | undefined,
  };
}

/**
 * Extract HTTP attributes from span
 */
export function extractHttpAttributes(span: Span) {
  return {
    method: span.attributes["http.method"] as string | undefined,
    url: span.attributes["http.url"] as string | undefined,
    target: span.attributes["http.target"] as string | undefined,
    route: span.attributes["http.route"] as string | undefined,
    statusCode: span.attributes["http.status_code"] as number | undefined,
    userAgent: span.attributes["http.user_agent"] as string | undefined,
  };
}

/**
 * Extract database attributes from span
 */
export function extractDbAttributes(span: Span) {
  return {
    system: span.attributes["db.system"] as string | undefined,
    name: span.attributes["db.name"] as string | undefined,
    statement: span.attributes["db.statement"] as string | undefined,
    operation: span.attributes["db.operation"] as string | undefined,
    table: span.attributes["db.sql.table"] as string | undefined,
  };
}

// ============================================================================
// TIME UTILITIES
// ============================================================================

/**
 * Format duration in human-readable format
 */
export function formatDuration(nanoseconds: number): string {
  const ms = nanoseconds / 1_000_000;

  if (ms < 1) {
    return `${(nanoseconds / 1000).toFixed(2)}μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Calculate time range presets
 */
export function getTimeRangePreset(preset: string): {
  start: string;
  end: string;
} {
  const end = new Date();
  let start: Date;

  switch (preset) {
    case "last_15m":
      start = new Date(end.getTime() - 15 * 60 * 1000);
      break;
    case "last_1h":
      start = new Date(end.getTime() - 60 * 60 * 1000);
      break;
    case "last_6h":
      start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
      break;
    case "last_24h":
      start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "last_7d":
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "last_30d":
      start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(end.getTime() - 60 * 60 * 1000);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// ============================================================================
// CORRELATION UTILITIES
// ============================================================================

/**
 * Group Playwright step spans
 */
export function groupPlaywrightSteps(spans: Span[]) {
  const steps = new Map<number, Span[]>();

  spans.forEach((span) => {
    const stepNumber = span.attributes["playwright.step"] as number | undefined;
    if (stepNumber !== undefined) {
      if (!steps.has(stepNumber)) {
        steps.set(stepNumber, []);
      }
      steps.get(stepNumber)!.push(span);
    }
  });

  return Array.from(steps.entries()).map(([stepNumber, stepSpans]) => ({
    stepNumber,
    stepName:
      stepSpans[0].attributes["playwright.step.name"] || `Step ${stepNumber}`,
    action: stepSpans[0].attributes["playwright.action"] || "unknown",
    selector: stepSpans[0].attributes["playwright.selector"],
    spans: stepSpans,
    duration: stepSpans.reduce((sum, s) => sum + s.duration, 0),
    status: stepSpans.some((s) => s.statusCode === 2) ? 2 : 1,
  }));
}

/**
 * Group K6 scenario spans
 */
export function groupK6Scenarios(spans: Span[]) {
  const scenarios = new Map<string, Span[]>();

  spans.forEach((span) => {
    const scenario = span.attributes["k6.scenario"] as string | undefined;
    if (scenario) {
      if (!scenarios.has(scenario)) {
        scenarios.set(scenario, []);
      }
      scenarios.get(scenario)!.push(span);
    }
  });

  return Array.from(scenarios.entries()).map(([scenarioName, scenarioSpans]) => ({
    scenarioName,
    executor: scenarioSpans[0].attributes["k6.executor"] || "unknown",
    spans: scenarioSpans,
    metrics: {
      vus: scenarioSpans[0].attributes["k6.vus"] as number || 0,
      iterations: scenarioSpans.length,
      duration: scenarioSpans.reduce((sum, s) => sum + s.duration, 0),
    },
  }));
}

const observabilityClient = {
  searchTraces,
  getTrace,
  getTraceByRunId,
  searchLogs,
  getLogsForTrace,
  getLogsForSpan,
  queryMetrics,
  getServiceMetrics,
  getEndpointMetrics,
  buildSpanTree,
  flattenSpanTree,
  findCriticalPath,
  buildFlamegraph,
  extractSuperCheckAttributes,
  extractHttpAttributes,
  extractDbAttributes,
  formatDuration,
  getTimeRangePreset,
  groupPlaywrightSteps,
  groupK6Scenarios,
};

export default observabilityClient;
