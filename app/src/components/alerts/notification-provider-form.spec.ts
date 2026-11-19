import { getUserFriendlyError } from "@/lib/error-utils";
import { createNotificationProviderSchema, getSaveErrorMessage, nextPresetUrl, readAuthToken, readRoutingKey, writeAuthToken, writeRoutingKey } from "./notification-provider-form";

const webhookConfig = {
  name: "Production webhook",
  url: "",
  preset: "custom" as const,
  method: "POST" as const,
  bodyTemplate: "",
};

describe("notification provider form validation", () => {
  it("requires a webhook URL when creating a channel", () => {
    const result = createNotificationProviderSchema().safeParse({
      type: "webhook",
      config: webhookConfig,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["config", "url"] }),
        ]),
      );
    }
  });

  it("allows an existing masked webhook URL to remain blank on edit", () => {
    const schema = createNotificationProviderSchema(
      new Set(["url"]),
      "webhook",
    );

    expect(
      schema.safeParse({ type: "webhook", config: webhookConfig }).success,
    ).toBe(true);
  });

  it("does not reuse a masked secret after changing channel type", () => {
    const schema = createNotificationProviderSchema(
      new Set(["webhookUrl"]),
      "slack",
    );
    const result = schema.safeParse({
      type: "teams",
      config: { name: "Production Teams", teamsWebhookUrl: "" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["config", "teamsWebhookUrl"] }),
        ]),
      );
    }
  });
});

describe("getSaveErrorMessage", () => {
  it("surfaces the API validation message", () => {
    expect(getSaveErrorMessage(new Error("Target URL: Webhook URL must use HTTPS"), "webhook")).toBe(
      "Target URL: Webhook URL must use HTTPS",
    );
  });

  it("falls back to the generic text for network failures", () => {
    expect(getSaveErrorMessage(new TypeError("Failed to fetch"), "webhook")).toBe(getUserFriendlyError(new TypeError("Failed to fetch"), "webhook"));
    expect(getSaveErrorMessage(new TypeError("Failed to fetch"), "webhook")).not.toContain("Failed to fetch");
  });
});

describe("nextPresetUrl", () => {
  const pagerduty = { id: "pagerduty", endpointPlaceholder: "https://events.pagerduty.com/v2/enqueue" };
  const jsm = { id: "jsm_ops", endpointPlaceholder: "https://api.atlassian.com/jsm/ops/integration/v2/alerts" };
  const splunk = { id: "splunk_on_call", endpointPlaceholder: "https://alert.victorops.com/integrations/generic/20131114/alert/<api_key>/<routing_key>" };

  it("fills an empty endpoint with the preset's fixed URL", () => {
    expect(nextPresetUrl("custom", "pagerduty", "", pagerduty)).toBe(pagerduty.endpointPlaceholder);
  });

  it("replaces the old service's endpoint when switching paging services, so the new key never goes to the old service", () => {
    expect(nextPresetUrl("pagerduty", "jsm_ops", pagerduty.endpointPlaceholder, jsm)).toBe(jsm.endpointPlaceholder);
    expect(nextPresetUrl("jsm_ops", "splunk_on_call", "https://api.atlassian.com/jsm/ops/integration/v2/alerts", splunk)).toBe("");
  });

  it("keeps a custom endpoint when choosing a preset from a custom webhook, or reselecting the same one", () => {
    expect(nextPresetUrl("custom", "jsm_ops", "https://api.atlassian.com/jsm/ops/integration/v2/alerts", jsm)).toBeUndefined();
    expect(nextPresetUrl("jsm_ops", "jsm_ops", "https://api.atlassian.com/jsm/ops/integration/v2/alerts", jsm)).toBeUndefined();
  });
});

describe("typed credential helpers", () => {
  it("reads and writes only the routing_key string, keeping the rest of the template as typed", () => {
    const template = '{\n  "routing_key":   "REPLACE_WITH_PAGERDUTY_ROUTING_KEY",\n  "summary": {{title}}\n}';
    expect(readRoutingKey(template)).toBe("");
    const written = writeRoutingKey(template, 'a"b$&');
    expect(written).toBe('{\n  "routing_key":   "a\\"b$&",\n  "summary": {{title}}\n}');
    expect(readRoutingKey(written)).toBe('a"b$&');
    expect(readRoutingKey(writeRoutingKey(written, "  "))).toBe("");
    expect(readRoutingKey('{"summary":"x"}')).toBeUndefined();
  });

  it("reads and writes the Authorization token, keeping other headers", () => {
    expect(readAuthToken("", "GenieKey")).toBe("");
    expect(readAuthToken('{"Authorization":"GenieKey REPLACE_WITH_JSM_INTEGRATION_KEY"}', "GenieKey")).toBe("");
    expect(readAuthToken('{"authorization":"geniekey abc"}', "GenieKey")).toBe("abc");
    expect(readAuthToken("{not json", "Bearer")).toBeUndefined();
    const written = writeAuthToken('{"X-Env":"prod","authorization":"Bearer old"}', "Bearer", " new ");
    expect(JSON.parse(written)).toEqual({ "X-Env": "prod", authorization: "Bearer new" });
    expect(writeAuthToken('{"Authorization":"Bearer old"}', "Bearer", "")).toBe("");
  });
});
