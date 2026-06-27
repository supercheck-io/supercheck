export type ConnectorQueryGuide = {
  label: string;
  queryLabel: string;
  queryPlaceholder: string;
  endpointPlaceholder: string;
  setupHint: string;
  credentialHint: string;
  examples: Array<{
    label: string;
    query: string;
    description: string;
  }>;
  docs?: Array<{
    label: string;
    href: string;
  }>;
};

const defaultGuide: ConnectorQueryGuide = {
  label: "Generic connector",
  queryLabel: "Query",
  queryPlaceholder: "Search for recent operational evidence",
  endpointPlaceholder: "https://api.example.com",
  setupHint: "Use a read-only endpoint reachable from the selected execution mode.",
  credentialHint: "Use read-only credentials. Leave empty to configure later.",
  examples: [
    {
      label: "Recent errors",
      query: "error",
      description: "Find recent error-shaped evidence for the selected service.",
    },
  ],
};

const guides: Record<string, ConnectorQueryGuide> = {
  github: {
    label: "GitHub",
    queryLabel: "Commit search",
    queryPlaceholder: "repo:acme/checkout deploy OR rollback",
    endpointPlaceholder: "https://api.github.com",
    setupHint: "Use the GitHub API endpoint. For GitHub Enterprise, use the enterprise API base URL.",
    credentialHint: "Use a read-only token with repository metadata access only.",
    examples: [
      {
        label: "Recent deploys",
        query: "repo:acme/checkout deploy",
        description: "Find deployment-related commits for a service repository.",
      },
      {
        label: "Rollback commits",
        query: "repo:acme/checkout rollback",
        description: "Find rollback commits that may explain a recovery.",
      },
    ],
    docs: [{ label: "GitHub commit search", href: "https://docs.github.com/en/search-github/searching-on-github/searching-commits" }],
  },
  kubernetes: {
    label: "Kubernetes",
    queryLabel: "Label selector",
    queryPlaceholder: "app=checkout",
    endpointPlaceholder: "https://kubernetes.default.svc",
    setupHint: "Use a Kubernetes API endpoint reachable from the app or Private Agent network.",
    credentialHint: "Use a service account token limited to read pods/events in the required namespaces.",
    examples: [
      {
        label: "Service pods",
        query: "app=checkout",
        description: "Inspect pod phase, readiness, and restart counts for one service.",
      },
      {
        label: "Canary pods",
        query: "app=checkout,track=canary",
        description: "Focus investigation on a canary or progressive rollout slice.",
      },
    ],
    docs: [{ label: "Kubernetes label selectors", href: "https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/" }],
  },
  prometheus: {
    label: "Prometheus",
    queryLabel: "PromQL",
    queryPlaceholder: 'sum(rate(http_requests_total{service="checkout",status=~"5.."}[5m]))',
    endpointPlaceholder: "https://prometheus.example.com",
    setupHint: "Use the Prometheus API base URL and keep query windows bounded to the incident timeframe.",
    credentialHint: "Use a read-only bearer token or proxy credential if your Prometheus endpoint requires auth.",
    examples: [
      {
        label: "5xx rate",
        query: 'sum(rate(http_requests_total{service="checkout",status=~"5.."}[5m]))',
        description: "Measure service error rate during the incident window.",
      },
      {
        label: "Latency p95",
        query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="checkout"}[5m])) by (le))',
        description: "Check whether latency moved before or during the incident.",
      },
    ],
    docs: [{ label: "Prometheus HTTP API", href: "https://prometheus.io/docs/prometheus/latest/querying/api/" }],
  },
  grafana: {
    label: "Grafana",
    queryLabel: "Dashboard search",
    queryPlaceholder: "checkout latency",
    endpointPlaceholder: "https://grafana.example.com",
    setupHint: "Use the Grafana API base URL. Dashboard search returns context links, not raw panel data.",
    credentialHint: "Use a read-only service account token with dashboard search permissions.",
    examples: [
      {
        label: "Service dashboards",
        query: "checkout",
        description: "Find dashboards related to the affected service.",
      },
      {
        label: "Latency views",
        query: "checkout latency",
        description: "Find dashboards that may contain useful latency panels.",
      },
    ],
    docs: [{ label: "Grafana search API", href: "https://grafana.com/docs/grafana/latest/developers/http_api/folder_dashboard_search/" }],
  },
  sentry: {
    label: "Sentry",
    queryLabel: "Issue query",
    queryPlaceholder: "is:unresolved level:error",
    endpointPlaceholder: "https://sentry.example.com/api/0/projects/acme/checkout",
    setupHint: "Use a Sentry project API endpoint. Keep the connector scoped to the service that owns the project.",
    credentialHint: "Use a read-only token that can list project issues but cannot mutate issue state.",
    examples: [
      {
        label: "Unresolved errors",
        query: "is:unresolved level:error",
        description: "Find active error issues during the incident window.",
      },
      {
        label: "Regression candidates",
        query: "is:unresolved firstSeen:-24h",
        description: "Focus on issues that first appeared recently.",
      },
    ],
    docs: [{ label: "Sentry search syntax", href: "https://docs.sentry.io/product/sentry-basics/search/" }],
  },
  datadog: {
    label: "Datadog",
    queryLabel: "Event tags",
    queryPlaceholder: "service:checkout env:prod",
    endpointPlaceholder: "https://api.datadoghq.com",
    setupHint: "Use the Datadog API site for the account region, such as api.datadoghq.eu for EU accounts.",
    credentialHint: "Use API and application keys with read-only event access.",
    examples: [
      {
        label: "Service events",
        query: "service:checkout env:prod",
        description: "Find monitor, deploy, and operational events for the affected service.",
      },
      {
        label: "Monitor alerts",
        query: "source:alert service:checkout",
        description: "Find Datadog alert events related to the incident.",
      },
    ],
    docs: [{ label: "Datadog events API", href: "https://docs.datadoghq.com/api/latest/events/" }],
  },
  loki: {
    label: "Loki",
    queryLabel: "LogQL",
    queryPlaceholder: '{service="checkout"} |= "error"',
    endpointPlaceholder: "https://loki.example.com",
    setupHint: "Use the Loki API base URL. Prefer label selectors that narrow to one service before text filters.",
    credentialHint: "Use a read-only token or gateway credential for query-range access.",
    examples: [
      {
        label: "Service errors",
        query: '{service="checkout"} |= "error"',
        description: "Find error log lines for the affected service.",
      },
      {
        label: "Timeouts",
        query: '{service="checkout"} |~ "timeout|deadline|upstream"',
        description: "Search for timeout patterns across logs.",
      },
    ],
    docs: [{ label: "Loki HTTP API", href: "https://grafana.com/docs/loki/latest/reference/loki-http-api/" }],
  },
  elasticsearch: {
    label: "Elasticsearch/OpenSearch",
    queryLabel: "Query string",
    queryPlaceholder: 'service.name:checkout AND (error OR exception)',
    endpointPlaceholder: "https://elasticsearch.example.com",
    setupHint: "Use an Elasticsearch-compatible API endpoint. Index and timestamp field filters can be set in diagnostic query definitions.",
    credentialHint: "Use a read-only credential limited to search APIs and approved log indices.",
    examples: [
      {
        label: "Service errors",
        query: 'service.name:checkout AND (error OR exception)',
        description: "Find error documents for the affected service.",
      },
      {
        label: "HTTP 5xx",
        query: 'service.name:checkout AND http.response.status_code:[500 TO 599]',
        description: "Find server-side HTTP failures in ECS-style logs.",
      },
    ],
    docs: [{ label: "Elasticsearch query string", href: "https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-query-string-query" }],
  },
  tempo: {
    label: "Grafana Tempo",
    queryLabel: "Trace search",
    queryPlaceholder: "service:checkout minDuration:1s",
    endpointPlaceholder: "https://tempo.example.com",
    setupHint: "Use the Tempo API base URL. Service/tag syntax is converted to Tempo search tags; TraceQL can be passed through directly.",
    credentialHint: "Use a read-only token or gateway credential for trace search APIs.",
    examples: [
      {
        label: "Slow traces",
        query: "service:checkout minDuration:1s",
        description: "Find slow traces for the affected service.",
      },
      {
        label: "TraceQL errors",
        query: '{ resource.service.name = "checkout" && status = error }',
        description: "Use TraceQL directly for error-shaped traces.",
      },
    ],
    docs: [{ label: "Tempo API", href: "https://grafana.com/docs/tempo/latest/api_docs/" }],
  },
  aws_cloudwatch: {
    label: "AWS CloudWatch",
    queryLabel: "Alarm or metric query",
    queryPlaceholder: "prefix:checkout state:ALARM",
    endpointPlaceholder: "https://monitoring.us-east-1.amazonaws.com",
    setupHint: "Use the regional CloudWatch endpoint for the workload account. Keep IAM permissions read-only and service scoped where possible.",
    credentialHint: "Use an access key with CloudWatch read-only permissions. Prefer short-lived STS credentials when possible.",
    examples: [
      {
        label: "Active alarms",
        query: "prefix:checkout state:ALARM",
        description: "Find active CloudWatch alarms matching a service prefix.",
      },
      {
        label: "Target latency",
        query: "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout stat:Average period:60",
        description: "Fetch bounded metric data for a specific CloudWatch metric.",
      },
    ],
    docs: [
      { label: "CloudWatch API", href: "https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/Welcome.html" },
      { label: "AWS IAM best practices", href: "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html" },
    ],
  },
};

export function getConnectorQueryGuide(type: string): ConnectorQueryGuide {
  return guides[type] ?? defaultGuide;
}
