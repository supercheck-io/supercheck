/**
 * TypeScript types and schemas for SuperCheck Observability module
 * Compatible with OpenTelemetry and SigNoz Query Service
 */

import { z } from "zod";

// ============================================================================
// CORE ENUMS AND CONSTANTS
// ============================================================================

export const RunType = {
  PLAYWRIGHT: "playwright",
  K6: "k6",
  JOB: "job",
  MONITOR: "monitor",
} as const;

export type RunType = (typeof RunType)[keyof typeof RunType];

export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const;

export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind];

export const SpanStatus = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export type SpanStatus = (typeof SpanStatus)[keyof typeof SpanStatus];

export const LogLevel = {
  TRACE: "TRACE",
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  FATAL: "FATAL",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const MetricType = {
  GAUGE: 0,
  SUM: 1,
  HISTOGRAM: 2,
  SUMMARY: 3,
} as const;

export type MetricType = (typeof MetricType)[keyof typeof MetricType];

// ============================================================================
// TRACE TYPES
// ============================================================================

export interface SpanEvent {
  name: string;
  timestamp: string; // ISO 8601
  timestampUnixNano: number;
  attributes: Record<string, unknown>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  traceState?: string;
  attributes: Record<string, unknown>;
}

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  kind: SpanKind;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  duration: number; // nanoseconds
  statusCode: SpanStatus;
  statusMessage?: string;

  // Attributes
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;

  // Events and links
  events?: SpanEvent[];
  links?: SpanLink[];

  // SuperCheck-specific attributes
  scOrgId?: string;
  scProjectId?: string;
  scRunId?: string;
  scRunType?: RunType;
  scTestId?: string;
  scTestName?: string;
  scJobId?: string;
  scJobName?: string;
  scMonitorId?: string;
  scMonitorType?: string;
  scWorkerId?: string;
  scRegion?: string;
  scArtifactsUrl?: string;
}

export interface Trace {
  traceId: string;
  rootSpanId: string;
  duration: number; // nanoseconds
  startedAt: string; // ISO 8601
  endedAt: string; // ISO 8601
  status: SpanStatus;
  serviceNames: string[];
  spanCount: number;
  errorCount: number;

  // SuperCheck context
  scOrgId?: string;
  scProjectId?: string;
  scRunId?: string;
  scRunType?: RunType;
  scTestName?: string;

  // Aggregated attributes
  attributes: Record<string, unknown>;
}

export interface TraceWithSpans extends Trace {
  spans: Span[];
}

// Trace tree structure for visualization
export interface SpanTreeNode extends Span {
  children: SpanTreeNode[];
  depth: number;
  selfTime: number; // Time excluding children
}

// ============================================================================
// LOG TYPES
// ============================================================================

export interface Log {
  timestamp: string; // ISO 8601
  observedTimestamp: string; // ISO 8601
  traceId?: string;
  spanId?: string;
  traceFlags?: number;
  severityText: LogLevel;
  severityNumber: number;
  body: string;

  // Attributes
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;

  // SuperCheck context
  serviceName?: string;
  scOrgId?: string;
  scProjectId?: string;
  scRunId?: string;
  scRunType?: RunType;
}

// ============================================================================
// METRIC TYPES
// ============================================================================

export interface MetricDataPoint {
  timestamp: string; // ISO 8601
  value: number;
  attributes: Record<string, string>;
}

export interface HistogramDataPoint extends MetricDataPoint {
  count: number;
  sum: number;
  bucketCounts: number[];
  explicitBounds: number[];
}

export interface SummaryDataPoint extends MetricDataPoint {
  count: number;
  sum: number;
  quantileValues: number[];
  quantiles: number[];
}

export interface Metric {
  name: string;
  type: MetricType;
  unit?: string;
  description?: string;
  dataPoints: MetricDataPoint[] | HistogramDataPoint[] | SummaryDataPoint[];
}

export interface TimeSeriesPoint {
  timestamp: string; // ISO 8601
  value: number;
  seriesKey: string;
}

export interface TimeSeries {
  name: string;
  points: TimeSeriesPoint[];
  labels: Record<string, string>;
}

// ============================================================================
// FILTER AND QUERY TYPES
// ============================================================================

export interface TimeRange {
  start: string; // ISO 8601
  end: string; // ISO 8601
}

export interface TraceFilters {
  organizationId?: string;
  projectId?: string;
  runType?: RunType | RunType[];
  runId?: string;
  testId?: string;
  jobId?: string;
  monitorId?: string;
  serviceName?: string | string[];
  status?: SpanStatus | SpanStatus[];
  minDuration?: number; // milliseconds
  maxDuration?: number; // milliseconds
  timeRange: TimeRange;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogFilters {
  organizationId?: string;
  projectId?: string;
  runType?: RunType | RunType[];
  runId?: string;
  serviceName?: string | string[];
  severityLevel?: LogLevel | LogLevel[];
  traceId?: string;
  spanId?: string;
  timeRange: TimeRange;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MetricFilters {
  organizationId?: string;
  projectId?: string;
  runType?: RunType | RunType[];
  serviceName?: string | string[];
  metricName?: string | string[];
  timeRange: TimeRange;
  groupBy?: string[];
  aggregation?: "avg" | "sum" | "min" | "max" | "p50" | "p95" | "p99";
  interval?: string; // e.g., "1m", "5m", "1h"
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TraceSearchResponse extends PaginatedResponse<Trace> {
  services: string[];
  runTypes: RunType[];
}

export interface LogSearchResponse extends PaginatedResponse<Log> {
  services: string[];
  levels: LogLevel[];
}

export interface MetricQueryResponse {
  metrics: TimeSeries[];
  timeRange: TimeRange;
}

// ============================================================================
// AGGREGATED METRICS TYPES
// ============================================================================

export interface ServiceMetrics {
  serviceName: string;
  requestCount: number;
  errorCount: number;
  errorRate: number; // percentage
  p50Latency: number; // milliseconds
  p95Latency: number; // milliseconds
  p99Latency: number; // milliseconds
  avgLatency: number; // milliseconds
  throughput: number; // requests per second
}

export interface EndpointMetrics extends ServiceMetrics {
  endpoint: string;
  httpMethod?: string;
}

export interface RunSummary {
  runId: string;
  runType: RunType;
  traceId: string;
  status: SpanStatus;
  duration: number; // milliseconds
  startedAt: string;
  endedAt: string;

  // Counts
  totalSpans: number;
  errorSpans: number;

  // Metrics
  services: string[];
  endpoints: EndpointMetrics[];

  // SuperCheck context
  testName?: string;
  jobName?: string;
  monitorType?: string;
  artifacts?: string;
}

// ============================================================================
// CORRELATION TYPES
// ============================================================================

export interface PlaywrightStepSpan {
  stepName: string;
  stepNumber: number;
  action: string; // click, fill, navigate, etc.
  selector?: string;
  spans: Span[];
  duration: number;
  status: SpanStatus;
}

export interface K6ScenarioSpan {
  scenarioName: string;
  executor: string; // constant-vus, ramping-vus, etc.
  spans: Span[];
  metrics: {
    vus: number;
    iterations: number;
    duration: number;
  };
}

export interface JobExecutionSpan {
  jobName: string;
  cronSchedule?: string;
  spans: Span[];
  status: SpanStatus;
}

export interface MonitorCheckSpan {
  monitorName: string;
  monitorType: string;
  location: string;
  spans: Span[];
  status: SpanStatus;
  responseTime: number;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface SpanSelection {
  span: Span;
  trace: Trace;
}

export interface TimelineViewState {
  zoomLevel: number;
  panOffset: number;
  selectedSpan?: SpanSelection;
  collapsedServices: Set<string>;
}

export interface FlamegraphNode {
  name: string;
  value: number; // duration
  children: FlamegraphNode[];
  span: Span;
}

// ============================================================================
// ZOD SCHEMAS FOR VALIDATION
// ============================================================================

export const TimeRangeSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
});

export const TraceFiltersSchema = z.object({
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  runType: z.union([
    z.enum(["playwright", "k6", "job", "monitor"]),
    z.array(z.enum(["playwright", "k6", "job", "monitor"])),
  ]).optional(),
  runId: z.string().optional(),
  testId: z.string().optional(),
  jobId: z.string().optional(),
  monitorId: z.string().optional(),
  serviceName: z.union([z.string(), z.array(z.string())]).optional(),
  status: z.union([z.number(), z.array(z.number())]).optional(),
  minDuration: z.number().optional(),
  maxDuration: z.number().optional(),
  timeRange: TimeRangeSchema,
  search: z.string().optional(),
  limit: z.number().min(1).max(1000).default(50),
  offset: z.number().min(0).default(0),
});

export const LogFiltersSchema = z.object({
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  runType: z.union([
    z.enum(["playwright", "k6", "job", "monitor"]),
    z.array(z.enum(["playwright", "k6", "job", "monitor"])),
  ]).optional(),
  runId: z.string().optional(),
  serviceName: z.union([z.string(), z.array(z.string())]).optional(),
  severityLevel: z.union([
    z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]),
    z.array(z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"])),
  ]).optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  timeRange: TimeRangeSchema,
  search: z.string().optional(),
  limit: z.number().min(1).max(10000).default(1000),
  offset: z.number().min(0).default(0),
});

export const MetricFiltersSchema = z.object({
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  runType: z.union([
    z.enum(["playwright", "k6", "job", "monitor"]),
    z.array(z.enum(["playwright", "k6", "job", "monitor"])),
  ]).optional(),
  serviceName: z.union([z.string(), z.array(z.string())]).optional(),
  metricName: z.union([z.string(), z.array(z.string())]).optional(),
  timeRange: TimeRangeSchema,
  groupBy: z.array(z.string()).optional(),
  aggregation: z.enum(["avg", "sum", "min", "max", "p50", "p95", "p99"]).optional(),
  interval: z.string().optional(),
});

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type SpanAttribute = string | number | boolean | string[] | number[] | boolean[];

export interface AttributeFilter {
  key: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "not_contains";
  value: SpanAttribute;
}

export interface QueryBuilder {
  filters: AttributeFilter[];
  timeRange: TimeRange;
  groupBy?: string[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

// ============================================================================
// EXPORT TYPE HELPERS
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;
