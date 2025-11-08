/**
 * Mock data for observability development and testing
 */

import type {
  Trace,
  TraceWithSpans,
  Span,
  Log,
  TimeSeries,
  ServiceMetrics,
  EndpointMetrics,
  TraceSearchResponse,
  LogSearchResponse,
  MetricQueryResponse,
} from "~/types/observability";

// ============================================================================
// MOCK SPANS
// ============================================================================

const now = new Date();
const baseTime = now.getTime() - 60000; // 1 minute ago

export const mockSpans: Span[] = [
  {
    spanId: "span-root-001",
    traceId: "trace-001",
    name: "playwright.test.run",
    serviceName: "supercheck-worker",
    kind: 1, // SERVER
    startTime: new Date(baseTime).toISOString(),
    endTime: new Date(baseTime + 5000_000_000).toISOString(),
    duration: 5000_000_000, // 5 seconds in nanoseconds
    statusCode: 1, // OK
    attributes: {
      "sc.org_id": "org-123",
      "sc.project_id": "proj-456",
      "sc.run_id": "run-789",
      "sc.run_type": "playwright",
      "sc.test_id": "test-abc",
      "sc.test_name": "Login Flow Test",
      "sc.worker_id": "worker-001",
      "sc.region": "us-east-1",
    },
    resourceAttributes: {
      "service.name": "supercheck-worker",
      "service.version": "1.0.0",
    },
  },
  {
    spanId: "span-step-001",
    traceId: "trace-001",
    parentSpanId: "span-root-001",
    name: "page.goto",
    serviceName: "supercheck-worker",
    kind: 2, // CLIENT
    startTime: new Date(baseTime + 100_000_000).toISOString(),
    endTime: new Date(baseTime + 800_000_000).toISOString(),
    duration: 700_000_000, // 700ms
    statusCode: 1,
    attributes: {
      "playwright.step": 1,
      "playwright.step.name": "Navigate to login page",
      "playwright.action": "goto",
      "http.url": "https://app.example.com/login",
      "http.method": "GET",
      "http.status_code": 200,
    },
    resourceAttributes: {
      "service.name": "supercheck-worker",
    },
  },
  {
    spanId: "span-http-001",
    traceId: "trace-001",
    parentSpanId: "span-step-001",
    name: "HTTP GET",
    serviceName: "nginx",
    kind: 1,
    startTime: new Date(baseTime + 150_000_000).toISOString(),
    endTime: new Date(baseTime + 750_000_000).toISOString(),
    duration: 600_000_000, // 600ms
    statusCode: 1,
    attributes: {
      "http.method": "GET",
      "http.url": "https://app.example.com/login",
      "http.target": "/login",
      "http.route": "/login",
      "http.status_code": 200,
      "net.peer.name": "app.example.com",
    },
    resourceAttributes: {
      "service.name": "nginx",
    },
  },
  {
    spanId: "span-db-001",
    traceId: "trace-001",
    parentSpanId: "span-http-001",
    name: "SELECT users",
    serviceName: "postgres",
    kind: 2,
    startTime: new Date(baseTime + 200_000_000).toISOString(),
    endTime: new Date(baseTime + 280_000_000).toISOString(),
    duration: 80_000_000, // 80ms
    statusCode: 1,
    attributes: {
      "db.system": "postgresql",
      "db.name": "supercheck",
      "db.statement": "SELECT * FROM users WHERE email = $1",
      "db.operation": "SELECT",
      "db.sql.table": "users",
    },
    resourceAttributes: {
      "service.name": "postgres",
    },
  },
  {
    spanId: "span-step-002",
    traceId: "trace-001",
    parentSpanId: "span-root-001",
    name: "page.fill",
    serviceName: "supercheck-worker",
    kind: 2,
    startTime: new Date(baseTime + 900_000_000).toISOString(),
    endTime: new Date(baseTime + 1100_000_000).toISOString(),
    duration: 200_000_000, // 200ms
    statusCode: 1,
    attributes: {
      "playwright.step": 2,
      "playwright.step.name": "Fill email field",
      "playwright.action": "fill",
      "playwright.selector": "input[name='email']",
    },
    resourceAttributes: {
      "service.name": "supercheck-worker",
    },
  },
];

export const mockTrace: TraceWithSpans = {
  traceId: "trace-001",
  rootSpanId: "span-root-001",
  duration: 5000_000_000,
  startedAt: new Date(baseTime).toISOString(),
  endedAt: new Date(baseTime + 5000_000_000).toISOString(),
  status: 1,
  serviceNames: ["supercheck-worker", "nginx", "postgres"],
  spanCount: 5,
  errorCount: 0,
  scOrgId: "org-123",
  scProjectId: "proj-456",
  scRunId: "run-789",
  scRunType: "playwright",
  scTestName: "Login Flow Test",
  attributes: {},
  spans: mockSpans,
};

// ============================================================================
// MOCK TRACE SEARCH RESPONSE
// ============================================================================

export const mockTraceSearchResponse: TraceSearchResponse = {
  data: [
    {
      traceId: "trace-001",
      rootSpanId: "span-root-001",
      duration: 5000_000_000,
      startedAt: new Date(baseTime).toISOString(),
      endedAt: new Date(baseTime + 5000_000_000).toISOString(),
      status: 1,
      serviceNames: ["supercheck-worker", "nginx", "postgres"],
      spanCount: 5,
      errorCount: 0,
      scRunType: "playwright",
      scTestName: "Login Flow Test",
      attributes: {},
    },
    {
      traceId: "trace-002",
      rootSpanId: "span-root-002",
      duration: 8000_000_000,
      startedAt: new Date(baseTime - 300000).toISOString(),
      endedAt: new Date(baseTime - 300000 + 8000_000_000).toISOString(),
      status: 2, // ERROR
      serviceNames: ["supercheck-worker", "api", "redis"],
      spanCount: 12,
      errorCount: 3,
      scRunType: "k6",
      scTestName: "Load Test - API",
      attributes: {},
    },
    {
      traceId: "trace-003",
      rootSpanId: "span-root-003",
      duration: 2000_000_000,
      startedAt: new Date(baseTime - 600000).toISOString(),
      endedAt: new Date(baseTime - 600000 + 2000_000_000).toISOString(),
      status: 1,
      serviceNames: ["supercheck-worker"],
      spanCount: 3,
      errorCount: 0,
      scRunType: "monitor",
      attributes: {},
    },
  ],
  total: 3,
  limit: 50,
  offset: 0,
  hasMore: false,
  services: ["supercheck-worker", "nginx", "postgres", "api", "redis"],
  runTypes: ["playwright", "k6", "monitor"],
};

// ============================================================================
// MOCK LOGS
// ============================================================================

export const mockLogs: Log[] = [
  {
    timestamp: new Date(baseTime + 100_000_000).toISOString(),
    observedTimestamp: new Date(baseTime + 100_000_000).toISOString(),
    traceId: "trace-001",
    spanId: "span-step-001",
    severityText: "INFO",
    severityNumber: 9,
    body: "Navigating to https://app.example.com/login",
    attributes: {
      "sc.run_id": "run-789",
      "sc.run_type": "playwright",
      module: "playwright",
    },
    resourceAttributes: {
      "service.name": "supercheck-worker",
    },
    serviceName: "supercheck-worker",
    scRunId: "run-789",
    scRunType: "playwright",
  },
  {
    timestamp: new Date(baseTime + 150_000_000).toISOString(),
    observedTimestamp: new Date(baseTime + 150_000_000).toISOString(),
    traceId: "trace-001",
    spanId: "span-http-001",
    severityText: "DEBUG",
    severityNumber: 5,
    body: "HTTP GET /login",
    attributes: {
      "http.method": "GET",
      "http.status_code": 200,
    },
    resourceAttributes: {
      "service.name": "nginx",
    },
    serviceName: "nginx",
  },
  {
    timestamp: new Date(baseTime + 200_000_000).toISOString(),
    observedTimestamp: new Date(baseTime + 200_000_000).toISOString(),
    traceId: "trace-001",
    spanId: "span-db-001",
    severityText: "DEBUG",
    severityNumber: 5,
    body: "Executing query: SELECT * FROM users WHERE email = $1",
    attributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "query.duration_ms": 80,
    },
    resourceAttributes: {
      "service.name": "postgres",
    },
    serviceName: "postgres",
  },
  {
    timestamp: new Date(baseTime + 900_000_000).toISOString(),
    observedTimestamp: new Date(baseTime + 900_000_000).toISOString(),
    traceId: "trace-001",
    spanId: "span-step-002",
    severityText: "INFO",
    severityNumber: 9,
    body: "Filling field: input[name='email']",
    attributes: {
      "sc.run_id": "run-789",
      "sc.run_type": "playwright",
      module: "playwright",
    },
    resourceAttributes: {
      "service.name": "supercheck-worker",
    },
    serviceName: "supercheck-worker",
    scRunId: "run-789",
    scRunType: "playwright",
  },
];

export const mockLogSearchResponse: LogSearchResponse = {
  data: mockLogs,
  total: 4,
  limit: 1000,
  offset: 0,
  hasMore: false,
  services: ["supercheck-worker", "nginx", "postgres"],
  levels: ["INFO", "DEBUG"],
};

// ============================================================================
// MOCK METRICS
// ============================================================================

export const mockTimeSeries: TimeSeries[] = [
  {
    name: "http.server.duration",
    labels: {
      service_name: "nginx",
      http_route: "/api/users",
    },
    points: Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(baseTime - (60 - i) * 60000).toISOString(),
      value: Math.random() * 100 + 50, // 50-150ms
      seriesKey: "nginx-/api/users",
    })),
  },
  {
    name: "http.server.duration",
    labels: {
      service_name: "nginx",
      http_route: "/api/auth",
    },
    points: Array.from({ length: 60 }, (_, i) => ({
      timestamp: new Date(baseTime - (60 - i) * 60000).toISOString(),
      value: Math.random() * 50 + 20, // 20-70ms
      seriesKey: "nginx-/api/auth",
    })),
  },
];

export const mockMetricQueryResponse: MetricQueryResponse = {
  metrics: mockTimeSeries,
  timeRange: {
    start: new Date(baseTime - 3600000).toISOString(),
    end: new Date(baseTime).toISOString(),
  },
};

// ============================================================================
// MOCK SERVICE METRICS
// ============================================================================

export const mockServiceMetrics: ServiceMetrics = {
  serviceName: "nginx",
  requestCount: 1250,
  errorCount: 15,
  errorRate: 1.2, // percentage
  p50Latency: 45, // milliseconds
  p95Latency: 120,
  p99Latency: 250,
  avgLatency: 65,
  throughput: 20.8, // requests per second
};

export const mockEndpointMetrics: EndpointMetrics[] = [
  {
    serviceName: "nginx",
    endpoint: "/api/users",
    httpMethod: "GET",
    requestCount: 450,
    errorCount: 5,
    errorRate: 1.1,
    p50Latency: 50,
    p95Latency: 130,
    p99Latency: 280,
    avgLatency: 70,
    throughput: 7.5,
  },
  {
    serviceName: "nginx",
    endpoint: "/api/auth/login",
    httpMethod: "POST",
    requestCount: 320,
    errorCount: 2,
    errorRate: 0.625,
    p50Latency: 85,
    p95Latency: 180,
    p99Latency: 350,
    avgLatency: 105,
    throughput: 5.3,
  },
  {
    serviceName: "nginx",
    endpoint: "/api/tests",
    httpMethod: "GET",
    requestCount: 280,
    errorCount: 8,
    errorRate: 2.86,
    p50Latency: 35,
    p95Latency: 95,
    p99Latency: 180,
    avgLatency: 48,
    throughput: 4.7,
  },
];

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

/**
 * Generate mock trace with random data
 */
export function generateMockTrace(overrides?: Partial<Trace>): Trace {
  const traceId = `trace-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now() - Math.random() * 3600000;
  const duration = (Math.random() * 5000 + 500) * 1_000_000; // 500ms - 5.5s

  return {
    traceId,
    rootSpanId: `span-${traceId}`,
    duration,
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date(startTime + duration / 1_000_000).toISOString(),
    status: Math.random() > 0.1 ? 1 : 2, // 90% success
    serviceNames: ["supercheck-worker", "api", "database"],
    spanCount: Math.floor(Math.random() * 20) + 3,
    errorCount: Math.random() > 0.1 ? 0 : Math.floor(Math.random() * 3) + 1,
    attributes: {},
    ...overrides,
  };
}

/**
 * Generate mock log with random data
 */
export function generateMockLog(overrides?: Partial<Log>): Log {
  const levels: Array<Log["severityText"]> = ["DEBUG", "INFO", "WARN", "ERROR"];
  const level = levels[Math.floor(Math.random() * levels.length)];
  const timestamp = new Date(Date.now() - Math.random() * 3600000);

  return {
    timestamp: timestamp.toISOString(),
    observedTimestamp: timestamp.toISOString(),
    severityText: level,
    severityNumber: level === "DEBUG" ? 5 : level === "INFO" ? 9 : level === "WARN" ? 13 : 17,
    body: `Sample log message at ${level} level`,
    attributes: {},
    resourceAttributes: {
      "service.name": "supercheck-worker",
    },
    serviceName: "supercheck-worker",
    ...overrides,
  };
}

/**
 * Generate multiple mock traces
 */
export function generateMockTraces(count: number): Trace[] {
  return Array.from({ length: count }, () => generateMockTrace());
}

/**
 * Generate multiple mock logs
 */
export function generateMockLogs(count: number): Log[] {
  return Array.from({ length: count }, () => generateMockLog());
}
