import type { ConnectorType } from "./connector-base";

export const SRE_CONNECTOR_TYPES = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "datadog",
  "splunk",
  "appdynamics",
  "newrelic",
  "sentry",
  "loki",
  "elasticsearch",
  "tempo",
  "jaeger",
  "opentelemetry",
  "aws_cloudwatch",
  "gcp_monitoring",
  "azure_monitor",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "clickhouse",
  "kafka",
  "rabbitmq",
  "gitlab",
  "confluence",
  "notion",
  "slack",
  "teams",
  "pagerduty",
  "opsgenie",
  "jira",
  "mcp",
  "webhook",
  "supercheck_native",
] as const satisfies readonly ConnectorType[];

export const DIRECT_VALIDATION_CONNECTOR_TYPES = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "sentry",
  "datadog",
  "loki",
  "elasticsearch",
  "tempo",
  "aws_cloudwatch",
] as const satisfies readonly ConnectorType[];

export const PRIVATE_AGENT_CONNECTOR_TYPES = DIRECT_VALIDATION_CONNECTOR_TYPES;

export const SETUP_ONLY_CONNECTOR_TYPES = [
  "jira",
  "confluence",
  "notion",
  "slack",
] as const satisfies readonly ConnectorType[];

export type SreConnectorType = (typeof SRE_CONNECTOR_TYPES)[number];

export function isDirectValidationConnectorType(connectorType: ConnectorType) {
  return DIRECT_VALIDATION_CONNECTOR_TYPES.includes(
    connectorType as (typeof DIRECT_VALIDATION_CONNECTOR_TYPES)[number],
  );
}

export function isPrivateAgentConnectorType(connectorType: ConnectorType) {
  return PRIVATE_AGENT_CONNECTOR_TYPES.includes(
    connectorType as (typeof PRIVATE_AGENT_CONNECTOR_TYPES)[number],
  );
}

export function isSetupOnlyConnectorType(connectorType: ConnectorType) {
  return SETUP_ONLY_CONNECTOR_TYPES.includes(
    connectorType as (typeof SETUP_ONLY_CONNECTOR_TYPES)[number],
  );
}
