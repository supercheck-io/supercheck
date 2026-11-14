import { getUserFriendlyError } from "@/lib/error-utils";
import { createNotificationProviderSchema, getSaveErrorMessage, nextPresetUrl } from "./notification-provider-form";

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
  const opsgenie = { id: "opsgenie", endpointPlaceholder: "https://api.opsgenie.com/v2/alerts" };
  const splunk = { id: "splunk_on_call", endpointPlaceholder: "https://alert.victorops.com/integrations/generic/20131114/alert/<api_key>/<routing_key>" };

  it("fills an empty endpoint with the preset's fixed URL", () => {
    expect(nextPresetUrl("custom", "pagerduty", "", pagerduty)).toBe(pagerduty.endpointPlaceholder);
  });

  it("replaces the old service's endpoint when switching paging services, so the new key never goes to the old service", () => {
    expect(nextPresetUrl("pagerduty", "opsgenie", pagerduty.endpointPlaceholder, opsgenie)).toBe(opsgenie.endpointPlaceholder);
    expect(nextPresetUrl("opsgenie", "splunk_on_call", "https://api.eu.opsgenie.com/v2/alerts", splunk)).toBe("");
  });

  it("keeps a custom endpoint when choosing a preset from a custom webhook, or reselecting the same one", () => {
    expect(nextPresetUrl("custom", "opsgenie", "https://api.eu.opsgenie.com/v2/alerts", opsgenie)).toBeUndefined();
    expect(nextPresetUrl("opsgenie", "opsgenie", "https://api.eu.opsgenie.com/v2/alerts", opsgenie)).toBeUndefined();
  });
});
