import type { SreConnectorType } from "@/lib/sre/connectors/connector-capabilities";

export type SreConnectorCatalogItem = {
  value: SreConnectorType;
  label: string;
  description: string;
  addable: boolean;
};

export const SRE_CONNECTOR_CATALOG: SreConnectorCatalogItem[] = [
  {
    value: "supercheck_native",
    label: "Supercheck",
    description: "Native tests, monitors, jobs, and runs",
    addable: false,
  },
  {
    value: "github",
    label: "GitHub",
    description: "Deploys, commits, and pull requests",
    addable: true,
  },
  {
    value: "gitlab",
    label: "GitLab",
    description: "Commits and deployment change context",
    addable: true,
  },
  {
    value: "kubernetes",
    label: "Kubernetes",
    description: "Pods, events, and workloads",
    addable: true,
  },
  {
    value: "prometheus",
    label: "Prometheus",
    description: "Metrics and PromQL",
    addable: true,
  },
  {
    value: "grafana",
    label: "Grafana",
    description: "Dashboards and panel context",
    addable: true,
  },
  {
    value: "sentry",
    label: "Sentry",
    description: "Issues, exceptions, and release regressions",
    addable: true,
  },
  {
    value: "datadog",
    label: "Datadog",
    description: "Alert and deployment events",
    addable: true,
  },
  {
    value: "loki",
    label: "Loki",
    description: "Logs and LogQL",
    addable: true,
  },
  {
    value: "elasticsearch",
    label: "Elasticsearch / OpenSearch",
    description: "Indexed logs and operational events",
    addable: true,
  },
  {
    value: "tempo",
    label: "Grafana Tempo",
    description: "Distributed traces and TraceQL",
    addable: true,
  },
  {
    value: "aws_cloudwatch",
    label: "AWS CloudWatch",
    description: "Metric alarms and metric data",
    addable: true,
  },
  {
    value: "pagerduty",
    label: "PagerDuty",
    description: "Incidents, urgency, and responder status",
    addable: true,
  },
  {
    value: "opsgenie",
    label: "Opsgenie",
    description: "Alerts, priorities, and responder state",
    addable: true,
  },
  {
    value: "splunk",
    label: "Splunk",
    description: "Logs and operational search",
    addable: false,
  },
  {
    value: "newrelic",
    label: "New Relic",
    description: "APM, incidents, metrics, and traces",
    addable: false,
  },
  {
    value: "appdynamics",
    label: "AppDynamics",
    description: "Application performance and topology",
    addable: false,
  },
  {
    value: "jaeger",
    label: "Jaeger",
    description: "Distributed traces",
    addable: false,
  },
  {
    value: "opentelemetry",
    label: "OpenTelemetry",
    description: "Telemetry signals and collector context",
    addable: false,
  },
  {
    value: "gcp_monitoring",
    label: "Google Cloud Monitoring",
    description: "Cloud metrics, alerts, and logs",
    addable: false,
  },
  {
    value: "azure_monitor",
    label: "Azure Monitor",
    description: "Cloud metrics, alerts, and logs",
    addable: false,
  },
  {
    value: "postgresql",
    label: "PostgreSQL",
    description: "Database health and query evidence",
    addable: false,
  },
  {
    value: "mysql",
    label: "MySQL",
    description: "Database health and query evidence",
    addable: false,
  },
  {
    value: "mongodb",
    label: "MongoDB",
    description: "Database health and operational evidence",
    addable: false,
  },
  {
    value: "redis",
    label: "Redis",
    description: "Cache health and operational evidence",
    addable: false,
  },
  {
    value: "clickhouse",
    label: "ClickHouse",
    description: "Analytics and observability data",
    addable: false,
  },
  {
    value: "kafka",
    label: "Kafka",
    description: "Broker health and consumer lag",
    addable: false,
  },
  {
    value: "rabbitmq",
    label: "RabbitMQ",
    description: "Queue health and delivery state",
    addable: false,
  },
  {
    value: "jira",
    label: "Jira",
    description: "Tickets, incidents, and change context",
    addable: false,
  },
  {
    value: "confluence",
    label: "Confluence",
    description: "Runbooks, postmortems, and operational docs",
    addable: false,
  },
  {
    value: "notion",
    label: "Notion",
    description: "Knowledge base, runbooks, and incident notes",
    addable: false,
  },
  {
    value: "slack",
    label: "Slack",
    description: "Incident channels and responder discussion",
    addable: false,
  },
  {
    value: "teams",
    label: "Microsoft Teams",
    description: "Incident channels and responder discussion",
    addable: false,
  },
  {
    value: "mcp",
    label: "MCP",
    description: "Approved external tool and context servers",
    addable: false,
  },
  {
    value: "webhook",
    label: "Webhook",
    description: "Inbound operational events",
    addable: false,
  },
];

export function getSreConnectorLabel(type: string) {
  return (
    SRE_CONNECTOR_CATALOG.find((item) => item.value === type)?.label ??
    type
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}
