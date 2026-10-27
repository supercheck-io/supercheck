import type { ConnectorQueryGuide } from "./connector-query-guides";

export const observabilityQueryGuides: Record<string, ConnectorQueryGuide> = {
  jaeger: {
    label: "Jaeger",
    queryLabel: "Trace search",
    queryPlaceholder: "service:checkout error:true minDuration:500ms",
    endpointPlaceholder: "https://jaeger.example.com",
    setupHint:
      "Use the Jaeger query service base URL (the one that serves /api/traces). Use a Private Agent for in-cluster Jaeger.",
    credentialHint:
      "Jaeger has no built-in auth. If a gateway or proxy protects it, use a read-only bearer token; otherwise leave empty.",
    examples: [
      {
        label: "Error traces",
        query: "service:checkout error:true",
        description: "Find traces with error spans for one service.",
      },
      {
        label: "Slow traces",
        query: 'service:checkout operation:"POST /cart" minDuration:1s',
        description: "Find slow traces for one operation.",
      },
      {
        label: "Known services",
        query: "*",
        description: "List the services Jaeger knows about.",
      },
    ],
    docs: [
      {
        label: "Jaeger query API",
        href: "https://www.jaegertracing.io/docs/latest/apis/",
      },
    ],
  },
  newrelic: {
    label: "New Relic",
    queryLabel: "NRQL query",
    queryPlaceholder:
      "SELECT count(*) FROM Transaction WHERE appName = 'checkout' AND error IS true FACET name",
    endpointPlaceholder: "Not required (fixed New Relic API host)",
    setupHint:
      "Supercheck calls NerdGraph on the US or EU New Relic API host. Set the region in the credential. The investigation time window is added automatically.",
    credentialHint:
      "Use a User API key from a user or service user with read-only access to the account. Ingest and license keys do not work.",
    examples: [
      {
        label: "Errors by transaction",
        query:
          "SELECT count(*) FROM Transaction WHERE appName = 'checkout' AND error IS true FACET name",
        description: "Aggregate error counts for an application.",
      },
      {
        label: "Error logs",
        query:
          "SELECT message FROM Log WHERE service.name = 'checkout' AND level = 'ERROR'",
        description: "Sample recent error log lines.",
      },
    ],
    docs: [
      { label: "NRQL syntax", href: "https://docs.newrelic.com/docs/nrql/nrql-syntax-clauses-functions/" },
      { label: "NerdGraph", href: "https://docs.newrelic.com/docs/apis/nerdgraph/get-started/introduction-new-relic-nerdgraph/" },
    ],
  },
  splunk: {
    label: "Splunk",
    queryLabel: "SPL search",
    queryPlaceholder: 'index=main service="checkout" error | stats count by sourcetype',
    endpointPlaceholder: "https://splunk.example.com:8089",
    setupHint:
      "Use the Splunk management (REST) endpoint, usually port 8089. The investigation time window is applied as earliest/latest.",
    credentialHint:
      "Use an authentication token for a user whose role has search capability and read access only to the needed indexes. No admin, delete or export-to-lookup capabilities.",
    examples: [
      {
        label: "Error events",
        query: 'index=main service="checkout" error',
        description: "Find error events for a service.",
      },
      {
        label: "Errors by sourcetype",
        query: 'index=main service="checkout" error | stats count by sourcetype',
        description: "Aggregate error counts.",
      },
    ],
    docs: [
      { label: "Splunk REST search", href: "https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTsearch" },
    ],
  },
  gcp_monitoring: {
    label: "Google Cloud Monitoring and Logging",
    queryLabel: "Logs or metrics filter",
    queryPlaceholder: 'logs: severity>=ERROR AND resource.labels.service_name="checkout"',
    endpointPlaceholder: "Not required (fixed Google API hosts)",
    setupHint:
      "Prefix the filter with logs: or metrics:. Metric filters must include metric.type. The time window is applied automatically.",
    credentialHint:
      "Paste a service account JSON key with only roles/monitoring.viewer and roles/logging.viewer on the project.",
    examples: [
      {
        label: "Error logs",
        query: 'logs: severity>=ERROR AND resource.labels.service_name="checkout"',
        description: "Cloud Logging entries at ERROR or above.",
      },
      {
        label: "Request count",
        query: 'metrics: metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="checkout"',
        description: "Cloud Monitoring time series for a Cloud Run service.",
      },
    ],
    docs: [
      { label: "Logging query language", href: "https://cloud.google.com/logging/docs/view/logging-query-language" },
      { label: "timeSeries.list", href: "https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list" },
    ],
  },
  azure_monitor: {
    label: "Azure Monitor",
    queryLabel: "KQL or metric query",
    queryPlaceholder: 'AppExceptions | where AppRoleName == "checkout" | summarize count() by ProblemId',
    endpointPlaceholder: "Not required (fixed Azure API hosts)",
    setupHint:
      "KQL runs against the Log Analytics workspace ID in the credential. Prefix with metrics: and a resource ID to read Azure Monitor metrics.",
    credentialHint:
      "Use an app registration (tenant, client ID, secret) with Monitoring Reader on the resources and Log Analytics Reader on the workspace.",
    examples: [
      {
        label: "Exceptions",
        query: 'AppExceptions | where AppRoleName == "checkout" | summarize count() by ProblemId',
        description: "Application Insights exceptions by problem.",
      },
      {
        label: "Resource metric",
        query: 'metrics: resource=/subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<name> names="Http5xx" agg=Total',
        description: "Azure Monitor metric for one resource.",
      },
    ],
    docs: [
      { label: "Log Analytics query API", href: "https://learn.microsoft.com/azure/azure-monitor/logs/api/request-format" },
      { label: "Azure Monitor metrics REST", href: "https://learn.microsoft.com/rest/api/monitor/metrics/list" },
    ],
  },
};
