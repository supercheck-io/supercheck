import type { DiagnosticQueryAdapterRecipe } from "../diagnostic-query-adapters";

const SERVICE = { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_.:-]+$" } as const;
const LIMITS = { maxRows: 50, maxBytes: 524_288, maxSeconds: 10 } as const;

export const OBSERVABILITY_QUERY_TYPES = {
  jaeger: ["http_get"],
  newrelic: ["http_get"],
  splunk: ["http_get"],
  gcp_monitoring: ["http_get"],
  azure_monitor: ["http_get"],
} as const;

export const observabilityDiagnosticRecipes: DiagnosticQueryAdapterRecipe[] = [
  {
    id: "jaeger-service-error-traces",
    connectorTypes: ["jaeger"],
    name: "Jaeger service error traces",
    description: "Traces with error spans for one service in the incident window.",
    queryType: "http_get",
    template: "service:$service error:true",
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "jaeger-slow-service-traces",
    connectorTypes: ["jaeger"],
    name: "Jaeger slow service traces",
    description: "Traces slower than an approved duration threshold for one service.",
    queryType: "http_get",
    template: "service:$service minDuration:$min_duration",
    parameterSchema: {
      service: SERVICE,
      min_duration: { type: "duration", default: "1s" },
    },
    allowlist: { service: [], min_duration: ["500ms", "1s", "5s"] },
    limits: LIMITS,
  },
  {
    id: "newrelic-error-rate-by-transaction",
    connectorTypes: ["newrelic"],
    name: "New Relic error count by transaction",
    description: "NRQL error count grouped by transaction name for one application.",
    queryType: "http_get",
    template:
      "SELECT count(*) FROM Transaction WHERE appName = '$service' AND error IS true FACET name LIMIT 20",
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "newrelic-latency-p95-by-transaction",
    connectorTypes: ["newrelic"],
    name: "New Relic latency p95",
    description: "NRQL 95th percentile duration grouped by transaction name.",
    queryType: "http_get",
    template:
      "SELECT percentile(duration, 95) FROM Transaction WHERE appName = '$service' FACET name LIMIT 20",
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "splunk-service-errors",
    connectorTypes: ["splunk"],
    name: "Splunk service errors",
    description: "Error-shaped events for one service, newest first.",
    queryType: "http_get",
    template: 'search service="$service" "$pattern" | sort - _time',
    parameterSchema: {
      service: SERVICE,
      pattern: { type: "string", enum: ["error", "exception", "timeout"], default: "error" },
    },
    allowlist: { service: [], pattern: ["error", "exception", "timeout"] },
    limits: LIMITS,
  },
  {
    id: "splunk-error-count-by-sourcetype",
    connectorTypes: ["splunk"],
    name: "Splunk error count by sourcetype",
    description: "Aggregated error counts for one service.",
    queryType: "http_get",
    template: 'search service="$service" error | stats count by sourcetype',
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "gcp-service-error-logs",
    connectorTypes: ["gcp_monitoring"],
    name: "Google Cloud service error logs",
    description: "Cloud Logging entries at ERROR or above for one Cloud Run service.",
    queryType: "http_get",
    template: 'logs: severity>=ERROR AND resource.labels.service_name="$service"',
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "gcp-cloud-run-request-count",
    connectorTypes: ["gcp_monitoring"],
    name: "Google Cloud Run request count",
    description: "Cloud Monitoring request_count series for one Cloud Run service.",
    queryType: "http_get",
    template:
      'metrics: metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="$service"',
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "azure-app-exceptions",
    connectorTypes: ["azure_monitor"],
    name: "Azure application exceptions",
    description: "Application Insights exceptions grouped by problem for one role.",
    queryType: "http_get",
    template:
      'logs: AppExceptions | where AppRoleName == "$service" | summarize count() by ProblemId',
    parameterSchema: { service: SERVICE },
    allowlist: { service: [] },
    limits: LIMITS,
  },
  {
    id: "azure-resource-metric",
    connectorTypes: ["azure_monitor"],
    name: "Azure resource metric",
    description: "One allowlisted Azure Monitor metric for a resource ID.",
    queryType: "http_get",
    template: 'metrics: resource=$resource names="$metric" agg=$agg interval=PT5M',
    parameterSchema: {
      resource: {
        type: "string",
        maxLength: 400,
        pattern: "^/subscriptions/[0-9a-fA-F-]{36}/resourceGroups/[\\w.()-]+/providers/[\\w.]+(/[\\w.()-]+){2,}$",
      },
      metric: { type: "string", enum: ["Percentage CPU", "Http5xx", "Requests", "HttpResponseTime"], default: "Http5xx" },
      agg: { type: "string", enum: ["Average", "Maximum", "Total"], default: "Total" },
    },
    allowlist: {
      resource: [],
      metric: ["Percentage CPU", "Http5xx", "Requests", "HttpResponseTime"],
      agg: ["Average", "Maximum", "Total"],
    },
    limits: LIMITS,
  },
];
