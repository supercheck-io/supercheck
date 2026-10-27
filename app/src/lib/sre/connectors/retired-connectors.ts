import type { ConnectorType } from "./connector-base";

/**
 * Types that are no longer offered as evidence sources. They stay in the
 * ConnectorType union so rows created earlier keep parsing and can be disabled.
 * Slack, Teams and webhooks remain available as notification channels.
 */
export const RETIRED_CONNECTOR_TYPES = [
  "opentelemetry",
  "slack",
  "teams",
  "webhook",
  "kafka",
  "rabbitmq",
] as const satisfies readonly ConnectorType[];

export function isRetiredConnectorType(connectorType: string) {
  return (RETIRED_CONNECTOR_TYPES as readonly string[]).includes(connectorType);
}

export function retiredConnectorExplanation(connectorType: string) {
  switch (connectorType) {
    case "opentelemetry":
      return "OpenTelemetry is not queried directly. Add the backend your collector exports to (Tempo, Jaeger, Loki, Prometheus, and so on).";
    case "slack":
    case "teams":
      return "Slack and Microsoft Teams are notification channels, not evidence sources. Existing connector rows stay inactive.";
    default:
      return "This type is no longer an evidence source. Disable the connector; it is not queried during investigations.";
  }
}
