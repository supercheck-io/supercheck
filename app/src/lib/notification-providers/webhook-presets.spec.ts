import {
  WEBHOOK_PRESETS,
  applyWebhookPresetConfig,
  assertWebhookPresetsHaveValidTemplates,
  getWebhookPreset,
} from "@/lib/notification-providers/webhook-presets";

describe("webhook-presets", () => {
  it("ships only valid JSON body templates", () => {
    expect(() => assertWebhookPresetsHaveValidTemplates()).not.toThrow();
  });

  it("includes setup docs for every preset", () => {
    expect(WEBHOOK_PRESETS.length).toBeGreaterThan(1);
    for (const preset of WEBHOOK_PRESETS) {
      expect(preset.docsUrl).toMatch(/^https:\/\//);
      expect(preset.endpointPlaceholder).toBeTruthy();
    }
  });

  it("uses VictorOps CRITICAL/RECOVERY placeholders in the Splunk On-Call preset", () => {
    const preset = getWebhookPreset("splunk_on_call");
    expect(preset?.config.bodyTemplate).toContain("{{victorOpsMessageType}}");
    expect(preset?.config.bodyTemplate).not.toContain('"{{alertAction}}"');
  });

  it("applies a preset without overwriting the target URL or provider name", () => {
    const config = applyWebhookPresetConfig("pagerduty", {
      name: "Primary incident route",
      url: "https://events.pagerduty.com/v2/enqueue",
    });

    expect(config.name).toBe("Primary incident route");
    expect(config.url).toBe("https://events.pagerduty.com/v2/enqueue");
    expect(config.method).toBe("POST");
    expect(config.preset).toBe("pagerduty");
    expect(config.bodyTemplate).toContain("{{pagerDutyEventAction}}");
  });

  it("keeps custom webhooks on user-authored payloads", () => {
    const config = applyWebhookPresetConfig("custom", {
      url: "https://example.com/hooks",
      method: "PUT",
      bodyTemplate: "{\"message\":\"{{title}}\"}",
    });

    expect(config.method).toBe("PUT");
    expect(config.bodyTemplate).toBe("{\"message\":\"{{title}}\"}");
    expect(config.preset).toBe("custom");
  });

  it("exposes provider-specific auth hints without embedding real secrets", () => {
    const opsgenie = getWebhookPreset("opsgenie");

    expect(opsgenie?.secretHint).toContain("Authorization");
    expect(opsgenie?.config.headers?.Authorization).toContain("REPLACE_WITH");
  });

  it("ships Jira Service Management with the Opsgenie payload and GenieKey auth", () => {
    const jsm = getWebhookPreset("jsm_ops");
    const opsgenie = getWebhookPreset("opsgenie");
    expect(jsm?.endpointPlaceholder).toBe("https://api.atlassian.com/jsm/ops/integration/v2/alerts");
    expect(jsm?.config.headers?.Authorization).toMatch(/^GenieKey REPLACE_WITH_/);
    expect(jsm?.config.bodyTemplate).toBe(opsgenie?.config.bodyTemplate);
    expect(opsgenie?.endsAt).toBe("April 5, 2027");
  });

  it("adds an Open in Supercheck link to new PagerDuty channels", () => {
    const template = JSON.parse(getWebhookPreset("pagerduty")!.config.bodyTemplate!);
    expect(template.links).toEqual([{ href: "{{dashboardUrl}}", text: "Open in Supercheck" }]);
  });

  it("names the Splunk On-Call routing key as the last URL segment", () => {
    expect(getWebhookPreset("splunk_on_call")?.endpointPlaceholder).toMatch(/\/<api_key>\/<routing_key>$/);
  });

  it("asks for the incident.io bearer token", () => {
    expect(getWebhookPreset("incident_io")?.config.headers?.Authorization).toMatch(/^Bearer REPLACE_WITH_/);
  });
});
