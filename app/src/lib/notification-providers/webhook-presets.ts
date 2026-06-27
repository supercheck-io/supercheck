import type { PlainNotificationProviderConfig } from "@/db/schema";
import { parseWebhookJsonTemplate } from "@/lib/notification-providers/webhook-template";

export const WEBHOOK_PRESET_IDS = [
  "custom",
  "pagerduty",
  "opsgenie",
  "splunk_on_call",
  "better_stack",
  "incident_io",
] as const;

export type WebhookPresetId = (typeof WEBHOOK_PRESET_IDS)[number];

export type WebhookPreset = {
  id: WebhookPresetId;
  label: string;
  summary: string;
  docsUrl: string;
  endpointPlaceholder: string;
  secretHint?: string;
  config: Pick<
    PlainNotificationProviderConfig,
    "method" | "headers" | "bodyTemplate"
  >;
};

const stringifyTemplate = (value: unknown) => JSON.stringify(value, null, 2);

export const WEBHOOK_PRESETS: WebhookPreset[] = [
  {
    id: "custom",
    label: "Custom webhook",
    summary:
      "Use the default Supercheck payload or author your own JSON template.",
    docsUrl: "https://docs.supercheck.io/app/communicate/alerts",
    endpointPlaceholder: "https://api.yourservice.com/alerts",
    config: {
      method: "POST",
      headers: {},
      bodyTemplate: "",
    },
  },
  {
    id: "pagerduty",
    label: "PagerDuty Events API v2",
    summary:
      "Trigger and resolve PagerDuty incidents with a stable dedup key.",
    docsUrl: "https://developer.pagerduty.com/docs/events-api-v2/overview/",
    endpointPlaceholder: "https://events.pagerduty.com/v2/enqueue",
    secretHint: "Replace the routing key placeholder in the JSON body.",
    config: {
      method: "POST",
      headers: {},
      bodyTemplate: stringifyTemplate({
        routing_key: "REPLACE_WITH_PAGERDUTY_ROUTING_KEY",
        event_action: "{{pagerDutyEventAction}}",
        dedup_key: "{{dedupKey}}",
        payload: {
          summary: "{{title}}",
          severity: "{{normalizedSeverity}}",
          source: "supercheck",
          component: "{{targetName}}",
          custom_details: {
            message: "{{message}}",
            alert_type: "{{type}}",
            status: "{{status}}",
            monitor_type: "{{monitorType}}",
            target_url: "{{targetUrl}}",
            response_time_ms: "{{responseTime}}",
            dashboard_url: "{{dashboardUrl}}",
            project: "{{projectName}}",
          },
        },
      }),
    },
  },
  {
    id: "opsgenie",
    label: "Opsgenie Alert API",
    summary:
      "Create Opsgenie alerts with Supercheck context and an alias for deduplication.",
    docsUrl: "https://docs.opsgenie.com/docs/alert-api",
    endpointPlaceholder: "https://api.opsgenie.com/v2/alerts",
    secretHint: "Set Authorization to GenieKey <api-key> in headers.",
    config: {
      method: "POST",
      headers: {
        Authorization: "GenieKey REPLACE_WITH_OPSGENIE_API_KEY",
      },
      bodyTemplate: stringifyTemplate({
        message: "{{title}}",
        alias: "{{dedupKey}}",
        description: "{{message}}",
        source: "supercheck",
        priority: "P2",
        tags: ["supercheck", "{{type}}", "{{monitorType}}"],
        details: {
          status: "{{status}}",
          target: "{{targetName}}",
          target_url: "{{targetUrl}}",
          response_time_ms: "{{responseTime}}",
          dashboard_url: "{{dashboardUrl}}",
          project: "{{projectName}}",
        },
      }),
    },
  },
  {
    id: "splunk_on_call",
    label: "Splunk On-Call REST endpoint",
    summary:
      "Send VictorOps/Splunk On-Call events with trigger and resolve lifecycle state.",
    docsUrl:
      "https://help.victorops.com/knowledge-base/rest-endpoint-integration-guide/",
    endpointPlaceholder:
      "https://alert.victorops.com/integrations/generic/20131114/alert/<routing_key>/<entity_id>",
    secretHint: "Replace routing key/entity segments in the endpoint URL.",
    config: {
      method: "POST",
      headers: {},
      bodyTemplate: stringifyTemplate({
        message_type: "{{alertAction}}",
        entity_id: "{{dedupKey}}",
        entity_display_name: "{{title}}",
        state_message: "{{message}}",
        monitoring_tool: "Supercheck",
        timestamp: "{{timestamp}}",
        status: "{{status}}",
        target: "{{targetName}}",
        target_url: "{{targetUrl}}",
        dashboard_url: "{{dashboardUrl}}",
      }),
    },
  },
  {
    id: "better_stack",
    label: "Better Stack webhook",
    summary:
      "Forward monitor and job alerts into Better Stack workflows with dedup context.",
    docsUrl: "https://betterstack.com/docs/uptime/integrations/webhooks/",
    endpointPlaceholder: "https://uptime.betterstack.com/api/v2/...",
    secretHint: "Verify the endpoint and authentication mode in Better Stack.",
    config: {
      method: "POST",
      headers: {},
      bodyTemplate: stringifyTemplate({
        name: "{{title}}",
        message: "{{message}}",
        source: "supercheck",
        status: "{{status}}",
        severity: "{{normalizedSeverity}}",
        dedup_key: "{{dedupKey}}",
        started_at: "{{timestamp}}",
        url: "{{dashboardUrl}}",
        metadata: {
          alert_type: "{{type}}",
          target: "{{targetName}}",
          target_url: "{{targetUrl}}",
          project: "{{projectName}}",
        },
      }),
    },
  },
  {
    id: "incident_io",
    label: "incident.io alert source",
    summary:
      "Send alert-source events with deduplication and dashboard context for triage.",
    docsUrl: "https://incident.io/docs/alert-sources",
    endpointPlaceholder: "https://api.incident.io/v2/alert_events/http/...",
    secretHint: "Use the HTTP alert source endpoint generated by incident.io.",
    config: {
      method: "POST",
      headers: {},
      bodyTemplate: stringifyTemplate({
        title: "{{title}}",
        description: "{{message}}",
        status: "{{status}}",
        severity: "{{normalizedSeverity}}",
        deduplication_key: "{{dedupKey}}",
        source: "supercheck",
        occurred_at: "{{timestamp}}",
        url: "{{dashboardUrl}}",
        metadata: {
          alert_type: "{{type}}",
          target: "{{targetName}}",
          target_url: "{{targetUrl}}",
          project: "{{projectName}}",
        },
      }),
    },
  },
];

const presetById = new Map<WebhookPresetId, WebhookPreset>(
  WEBHOOK_PRESETS.map((preset) => [preset.id, preset]),
);

export function getWebhookPreset(id: unknown): WebhookPreset | undefined {
  return typeof id === "string"
    ? presetById.get(id as WebhookPresetId)
    : undefined;
}

export function applyWebhookPresetConfig(
  presetId: WebhookPresetId,
  currentConfig: PlainNotificationProviderConfig,
): PlainNotificationProviderConfig {
  const preset = getWebhookPreset(presetId);
  if (!preset || preset.id === "custom") {
    return {
      ...currentConfig,
      preset: "custom",
    };
  }

  return {
    ...currentConfig,
    preset: preset.id,
    method: preset.config.method,
    headers: preset.config.headers ?? {},
    bodyTemplate: preset.config.bodyTemplate,
  };
}

export function assertWebhookPresetsHaveValidTemplates(): void {
  for (const preset of WEBHOOK_PRESETS) {
    if (!preset.config.bodyTemplate) {
      continue;
    }

    parseWebhookJsonTemplate(preset.config.bodyTemplate);
  }
}
