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
});
