import {
  normalizeProviderConfig,
  normalizeWebhookHeaders,
  validateProviderConfig,
} from "@/lib/notification-providers/validation";

describe("notification provider validation", () => {
  it("allows integration auth headers for generic webhooks", () => {
    expect(() =>
      validateProviderConfig("webhook", {
        url: "https://api.opsgenie.com/v2/alerts",
        method: "POST",
        preset: "opsgenie",
        headers: {
          Authorization: "GenieKey test-key",
        },
      }),
    ).not.toThrow();
  });

  it("rejects webhook headers that override managed transport headers", () => {
    expect(() =>
      normalizeWebhookHeaders({
        "Content-Type": "text/plain",
      }),
    ).toThrow('Webhook header "Content-Type" is managed by Supercheck.');

    expect(() =>
      normalizeWebhookHeaders({
        Host: "metadata.google.internal",
      }),
    ).toThrow('Webhook header "Host" is managed by Supercheck.');
  });

  it("normalizes supported webhook fields and removes empty headers/templates", () => {
    const normalized = normalizeProviderConfig("webhook", {
      url: "https://api.example.com/alerts",
      method: " put ",
      headers: {
        Authorization: " Bearer token ",
        "": "",
      },
      bodyTemplate: "  ",
    });

    expect(normalized.method).toBe("PUT");
    expect(normalized.headers).toEqual({ Authorization: "Bearer token" });
    expect(normalized.bodyTemplate).toBeUndefined();
  });

  it("rejects unsupported webhook presets", () => {
    expect(() =>
      validateProviderConfig("webhook", {
        url: "https://api.example.com/alerts",
        preset: "not-real",
      }),
    ).toThrow("Webhook preset is not supported.");
  });
});
