import type { PlainNotificationProviderConfig } from "@/db/schema";
import {
  normalizeWebhookMethod,
  renderWebhookJsonTemplate,
  type WebhookMethod,
} from "@/lib/notification-providers/webhook-template";

export const WEBHOOK_TEST_PAYLOAD = {
  test: true,
  message: "Connection test from Supercheck",
} as const;

export const WEBHOOK_SAMPLE_TEMPLATE_VARIABLES: Record<string, string> = {
  title: 'Test "Alert"',
  message: "Connection test from Supercheck",
  severity: "error",
  normalizedSeverity: "error",
  status: "down",
  monitorName: "Test Monitor",
  targetName: "Test Monitor",
  targetUrl: "https://example.com/health",
  targetId: "test-target-id",
  timestamp: "2026-06-28T10:30:00.000Z",
  type: "monitor_down",
  projectName: "Test Project",
  projectId: "test-project-id",
  responseTime: "5200",
  errorMessage: 'Connection timeout on "health" check',
  monitorType: "http_request",
  dashboardUrl: "https://app.supercheck.io/notification-monitor/test-target-id",
  alertAction: "trigger",
  eventAction: "trigger",
  pagerDutyEventAction: "trigger",
  dedupKey: "monitor:test-target-id",
};

export type WebhookPayloadPreview = {
  method: WebhookMethod;
  hasBody: boolean;
  usesTemplate: boolean;
  body?: string;
  error?: string;
};

type WebhookPreviewConfig = Pick<
  PlainNotificationProviderConfig,
  "method" | "bodyTemplate"
>;

export function buildWebhookTestBody(
  config: WebhookPreviewConfig,
): string | undefined {
  const method = normalizeWebhookMethod(config.method);
  if (method === "GET") {
    return undefined;
  }

  const template = config.bodyTemplate?.trim();
  if (!template) {
    return JSON.stringify(WEBHOOK_TEST_PAYLOAD);
  }

  return renderWebhookJsonTemplate(
    template,
    WEBHOOK_SAMPLE_TEMPLATE_VARIABLES,
  );
}

export function buildWebhookPayloadPreview(
  config: WebhookPreviewConfig,
): WebhookPayloadPreview {
  const method = normalizeWebhookMethod(config.method);
  if (method === "GET") {
    return {
      method,
      hasBody: false,
      usesTemplate: false,
    };
  }

  const usesTemplate = Boolean(config.bodyTemplate?.trim());

  try {
    const body = buildWebhookTestBody(config);
    return {
      method,
      hasBody: Boolean(body),
      usesTemplate,
      body: body ? JSON.stringify(JSON.parse(body), null, 2) : undefined,
    };
  } catch (error) {
    return {
      method,
      hasBody: true,
      usesTemplate,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
