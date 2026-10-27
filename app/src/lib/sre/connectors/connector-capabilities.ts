import type { ConnectorType } from "./connector-base";

export const SRE_CONNECTOR_TYPES = [
  "github",
  "kubernetes",
  "prometheus",
  "grafana",
  "datadog",
  "splunk",
  "newrelic",
  "sentry",
  "loki",
  "elasticsearch",
  "tempo",
  "jaeger",
  "aws_cloudwatch",
  "gcp_monitoring",
  "azure_monitor",
  "gitlab",
  "confluence",
  "notion",
  "pagerduty",
  "opsgenie",
  "jira",
  "mcp",
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
  "gitlab",
  "pagerduty",
  "opsgenie",
  "jaeger",
  "newrelic",
  "splunk",
  "gcp_monitoring",
  "azure_monitor",
  "jira",
  "confluence",
  "notion",
] as const satisfies readonly ConnectorType[];

export const PRIVATE_AGENT_CONNECTOR_TYPES = [
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
  "jaeger",
  "newrelic",
  "splunk",
  "gcp_monitoring",
  "azure_monitor",
  "jira",
  "confluence",
  "mcp",
] as const satisfies readonly ConnectorType[];

// These APIs can be intentionally unauthenticated inside a private network.
// Validation must make the real request and treat 401/403 as credential
// failures instead of blocking configuration before the endpoint is reached.
export const OPTIONAL_CREDENTIAL_CONNECTOR_TYPES = [
  "prometheus",
  "grafana",
  "loki",
  "tempo",
  "jaeger",
  "mcp",
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

export function connectorRequiresCredentials(connectorType: ConnectorType) {
  return !OPTIONAL_CREDENTIAL_CONNECTOR_TYPES.includes(
    connectorType as (typeof OPTIONAL_CREDENTIAL_CONNECTOR_TYPES)[number],
  );
}

export function isLiveSearchConnectorType(connectorType: ConnectorType) {
  return (
    isDirectValidationConnectorType(connectorType) ||
    isPrivateAgentConnectorType(connectorType)
  );
}
