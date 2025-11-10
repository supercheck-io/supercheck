/**
 * Observability data helpers powered by ClickHouse.
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
import {
  searchTracesClickHouse,
  searchLogsClickHouse,
  getTraceWithSpansClickHouse,
  getTraceForRunClickHouse,
  queryMetricsClickHouse,
  getServiceMetricsClickHouse,
  getEndpointMetricsClickHouse,
} from "./clickhouse-client";

// ============================================================================
// TRACE APIs
// ============================================================================

export async function searchTraces(
  filters: TraceFilters
): Promise<TraceSearchResponse> {
  return searchTracesClickHouse(filters);
}

export async function getTrace(traceId: string): Promise<TraceWithSpans> {
  const trace = await getTraceWithSpansClickHouse(traceId);
  if (!trace) {
    throw new Error(`Trace not found: ${traceId}`);
  }
  return trace;
}

export async function getTraceByRunId(
  runId: string
): Promise<TraceWithSpans | null> {
  if (!runId) return null;
  return getTraceForRunClickHouse(runId);
}

// ============================================================================
// LOG APIs
// ============================================================================

export async function searchLogs(
  filters: LogFilters
): Promise<LogSearchResponse> {
  return searchLogsClickHouse(filters);
}

export async function getLogsForTrace(traceId: string): Promise<Log[]> {
  if (!traceId) return [];

  const result = await searchLogs({
    traceId,
    timeRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    limit: 10_000,
  });

  return result.data;
}

export async function getLogsForSpan(spanId: string): Promise<Log[]> {
  if (!spanId) return [];

  const result = await searchLogs({
    spanId,
    timeRange: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
    limit: 1_000,
  });

  return result.data;
}

// ============================================================================
// METRIC APIs
// ============================================================================

export async function queryMetrics(
  filters: MetricFilters
): Promise<MetricQueryResponse> {
  return queryMetricsClickHouse(filters);
}

export async function getServiceMetrics(
  serviceName: string,
  timeRange: { start: string; end: string },
  projectId?: string,
  organizationId?: string
): Promise<ServiceMetrics> {
  return getServiceMetricsClickHouse(serviceName, timeRange, projectId, organizationId);
}

export async function getEndpointMetrics(
  serviceName: string,
  timeRange: { start: string; end: string },
  projectId?: string,
  organizationId?: string
): Promise<EndpointMetrics[]> {
  return getEndpointMetricsClickHouse(serviceName, timeRange, projectId, organizationId);
}
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
    orgId: span.attributes["sc.organization_id"] as string | undefined,
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
