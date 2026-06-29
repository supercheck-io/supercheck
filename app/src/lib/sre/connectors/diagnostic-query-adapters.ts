import type { DiagnosticQueryType } from "./diagnostic-query";

export type DiagnosticQueryAdapterRecipe = {
  id: string;
  connectorTypes: string[];
  name: string;
  description: string;
  queryType: DiagnosticQueryType;
  template: string;
  parameterSchema: Record<string, unknown>;
  allowlist: Record<string, unknown>;
  limits: {
    maxRows: number;
    maxBytes: number;
    maxSeconds: number;
  };
};

const CONNECTOR_QUERY_TYPES: Record<string, DiagnosticQueryType[]> = {
  prometheus: ["promql"],
  loki: ["logql"],
  tempo: ["traceql"],
  aws_cloudwatch: ["http_get"],
  elasticsearch: ["http_get"],
  datadog: ["http_get"],
  sentry: ["http_get"],
  grafana: ["http_get"],
  github: ["http_get"],
  kubernetes: ["http_get"],
  postgresql: ["sql"],
  mysql: ["sql"],
  clickhouse: ["sql"],
};

export const diagnosticQueryAdapterRecipes: DiagnosticQueryAdapterRecipe[] = [
  {
    id: "prometheus-http-5xx-rate",
    connectorTypes: ["prometheus"],
    name: "Prometheus HTTP 5xx rate",
    description: "Bounded PromQL for service 5xx rate during the incident window.",
    queryType: "promql",
    template: 'sum(rate(http_requests_total{service="$service",status=~"5.."}[$window]))',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
      window: { type: "duration", default: "5m" },
    },
    allowlist: { service: ["checkout"], window: ["1m", "5m", "15m"] },
    limits: { maxRows: 50, maxBytes: 262_144, maxSeconds: 10 },
  },
  {
    id: "prometheus-latency-p95",
    connectorTypes: ["prometheus"],
    name: "Prometheus latency p95",
    description: "Histogram p95 latency grouped by route for one service.",
    queryType: "promql",
    template: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="$service"}[$window])) by (le, route))',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
      window: { type: "duration", default: "5m" },
    },
    allowlist: { service: ["checkout"], window: ["1m", "5m", "15m"] },
    limits: { maxRows: 100, maxBytes: 524_288, maxSeconds: 10 },
  },
  {
    id: "loki-service-errors",
    connectorTypes: ["loki"],
    name: "Loki service errors",
    description: "Label-scoped LogQL for common error patterns.",
    queryType: "logql",
    template: '{service="$service"} |= "$pattern"',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
      pattern: { type: "string", enum: ["error", "timeout", "deadline"], default: "error" },
    },
    allowlist: { service: ["checkout"], pattern: ["error", "timeout", "deadline"] },
    limits: { maxRows: 100, maxBytes: 524_288, maxSeconds: 10 },
  },
  {
    id: "tempo-service-error-traces",
    connectorTypes: ["tempo"],
    name: "Tempo service error traces",
    description: "TraceQL for error traces scoped to one service.",
    queryType: "traceql",
    template: '{ resource.service.name = "$service" && status = error }',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
    },
    allowlist: { service: ["checkout"] },
    limits: { maxRows: 50, maxBytes: 524_288, maxSeconds: 10 },
  },
  {
    id: "tempo-slow-service-traces",
    connectorTypes: ["tempo"],
    name: "Tempo slow service traces",
    description: "TraceQL for traces slower than an approved duration threshold.",
    queryType: "traceql",
    template: '{ resource.service.name = "$service" && duration > $min_duration }',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
      min_duration: { type: "duration", default: "1s" },
    },
    allowlist: { service: ["checkout"], min_duration: ["500ms", "1s", "5s"] },
    limits: { maxRows: 50, maxBytes: 524_288, maxSeconds: 10 },
  },
  {
    id: "cloudwatch-active-alarms",
    connectorTypes: ["aws_cloudwatch"],
    name: "CloudWatch active alarms",
    description: "CloudWatch alarm lookup with explicit prefix and state.",
    queryType: "http_get",
    template: "prefix:$alarm_prefix state:$state",
    parameterSchema: {
      alarm_prefix: { type: "string", maxLength: 120, pattern: "^[a-zA-Z0-9_.:/-]+$" },
      state: { type: "string", enum: ["ALARM", "OK", "INSUFFICIENT_DATA"], default: "ALARM" },
    },
    allowlist: { alarm_prefix: ["checkout"], state: ["ALARM", "OK", "INSUFFICIENT_DATA"] },
    limits: { maxRows: 50, maxBytes: 262_144, maxSeconds: 10 },
  },
  {
    id: "cloudwatch-metric-data",
    connectorTypes: ["aws_cloudwatch"],
    name: "CloudWatch metric data",
    description: "CloudWatch metric-data query with allowlisted namespace, metric, dimension, statistic, and period.",
    queryType: "http_get",
    template: "namespace:$namespace metric:$metric dimension:$dimension stat:$stat period:$period",
    parameterSchema: {
      namespace: { type: "string", maxLength: 120 },
      metric: { type: "string", maxLength: 120 },
      dimension: { type: "string", maxLength: 300 },
      stat: { type: "string", enum: ["Average", "Sum", "Maximum", "Minimum", "p95"], default: "Average" },
      period: { type: "number", min: 60, max: 3600, default: 60 },
    },
    allowlist: {
      namespace: ["AWS/ApplicationELB"],
      metric: ["TargetResponseTime", "HTTPCode_Target_5XX_Count"],
      dimension: ["LoadBalancer=app/checkout"],
      stat: ["Average", "Sum", "Maximum", "Minimum", "p95"],
      period: [60, 300],
    },
    limits: { maxRows: 50, maxBytes: 262_144, maxSeconds: 10 },
  },
  {
    id: "elasticsearch-service-errors",
    connectorTypes: ["elasticsearch"],
    name: "Elasticsearch service errors",
    description: "Query-string diagnostic for indexed service error documents.",
    queryType: "http_get",
    template: 'service.name:$service AND ($pattern)',
    parameterSchema: {
      service: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" },
      pattern: { type: "string", enum: ["error", "exception", "timeout"], default: "error" },
    },
    allowlist: { service: ["checkout"], pattern: ["error", "exception", "timeout"] },
    limits: { maxRows: 100, maxBytes: 524_288, maxSeconds: 10 },
  },
];

export function getSupportedDiagnosticQueryTypes(connectorType: string): DiagnosticQueryType[] | null {
  return CONNECTOR_QUERY_TYPES[connectorType] ?? null;
}

export function isDiagnosticQueryTypeCompatible(connectorType: string, queryType: DiagnosticQueryType) {
  const supportedTypes = getSupportedDiagnosticQueryTypes(connectorType);
  return supportedTypes ? supportedTypes.includes(queryType) : true;
}

export function getDiagnosticQueryAdapterRecipes(connectorType: string) {
  return diagnosticQueryAdapterRecipes.filter((recipe) => recipe.connectorTypes.includes(connectorType));
}
