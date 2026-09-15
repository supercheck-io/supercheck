import type {
  NotificationProviderConfig,
  NotificationProviderType,
} from "@/db/schema";
import { getWebhookPreset } from "@/lib/notification-providers/webhook-presets";

export const SRE_INTEGRATION_KEYS = [
  "pagerduty",
  "opsgenie",
  "splunk_on_call",
  "better_stack",
  "incident_io",
  "slack",
  "teams",
  "generic_webhook",
] as const;

export type SreIntegrationKey = (typeof SRE_INTEGRATION_KEYS)[number];

export const SRE_INTEGRATION_CORRELATION_STRATEGIES = [
  "dedup_key",
  "alias",
  "entity_id",
  "incident_url",
  "thread",
  "custom",
] as const;

export type SreIntegrationCorrelationStrategy =
  (typeof SRE_INTEGRATION_CORRELATION_STRATEGIES)[number];

export type BindableSreConnectorType =
  | "pagerduty"
  | "opsgenie"
  | "splunk"
  | "slack"
  | "teams"
  | "webhook";

const compatibleConnectorTypes: Record<
  SreIntegrationKey,
  readonly BindableSreConnectorType[]
> = {
  pagerduty: ["pagerduty"],
  opsgenie: ["opsgenie"],
  splunk_on_call: ["splunk", "webhook"],
  better_stack: ["webhook"],
  incident_io: ["webhook"],
  slack: ["slack"],
  teams: ["teams"],
  generic_webhook: ["webhook"],
};

const defaultCorrelationStrategy: Record<
  SreIntegrationKey,
  SreIntegrationCorrelationStrategy
> = {
  pagerduty: "dedup_key",
  opsgenie: "alias",
  splunk_on_call: "entity_id",
  better_stack: "dedup_key",
  incident_io: "dedup_key",
  slack: "thread",
  teams: "thread",
  generic_webhook: "custom",
};

export function getNotificationProviderIntegrationKey(input: {
  type: NotificationProviderType;
  config: NotificationProviderConfig;
}): SreIntegrationKey | null {
  if (input.type === "slack") {
    return "slack";
  }

  if (input.type === "teams") {
    return "teams";
  }

  if (input.type !== "webhook") {
    return null;
  }

  const preset = getWebhookPreset(
    (input.config as Record<string, unknown>).preset,
  );
  if (!preset || preset.id === "custom") {
    return "generic_webhook";
  }

  return preset.id;
}

export function canBindIntegrationToConnector(
  integrationKey: SreIntegrationKey,
  connectorType: string,
): connectorType is BindableSreConnectorType {
  return compatibleConnectorTypes[integrationKey].includes(
    connectorType as BindableSreConnectorType,
  );
}

export function getDefaultCorrelationStrategy(
  integrationKey: SreIntegrationKey,
): SreIntegrationCorrelationStrategy {
  return defaultCorrelationStrategy[integrationKey];
}

export function describeIntegrationBindingCompatibility(input: {
  providerType: NotificationProviderType;
  providerConfig: NotificationProviderConfig;
  connectorType: string;
}): {
  bindable: boolean;
  integrationKey: SreIntegrationKey | null;
  correlationStrategy: SreIntegrationCorrelationStrategy | null;
  reason?: string;
} {
  const integrationKey = getNotificationProviderIntegrationKey({
    type: input.providerType,
    config: input.providerConfig,
  });

  if (!integrationKey) {
    return {
      bindable: false,
      integrationKey: null,
      correlationStrategy: null,
      reason: "Notification provider type does not support SRE connector binding.",
    };
  }

  if (!canBindIntegrationToConnector(integrationKey, input.connectorType)) {
    return {
      bindable: false,
      integrationKey,
      correlationStrategy: null,
      reason: "Connector type does not match the notification integration.",
    };
  }

  return {
    bindable: true,
    integrationKey,
    correlationStrategy: getDefaultCorrelationStrategy(integrationKey),
  };
}
