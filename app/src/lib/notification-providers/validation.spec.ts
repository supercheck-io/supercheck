import {
  normalizeProviderConfig,
  normalizeWebhookHeaders,
  validateProviderConfig,
  validateProviderWebhookUrl,
} from "@/lib/notification-providers/validation";

describe("notification provider validation", () => {
  it("requires valid email addresses for email providers", () => {
    expect(() => validateProviderConfig("email", { emails: "" })).toThrow("at least one");
    expect(() => validateProviderConfig("email", { emails: "not-an-email" })).toThrow("valid email");
    expect(() => validateProviderConfig("email", { emails: "a@b.co, bad" })).toThrow("valid email");
    // Delivery of an already-stored provider is not blocked by the stricter write-time format check.
    expect(() => validateProviderConfig("email", { emails: "a@b.co, bad" }, "send")).not.toThrow();
    expect(() => validateProviderConfig("email", { emails: "" }, "send")).toThrow("at least one");
    // The API accepts an array and stores the comma-separated string the test endpoint, form and worker read.
    expect(() => validateProviderConfig("email", { emails: ["a@b.co", "c@d.io"] })).not.toThrow();
    expect(() => validateProviderConfig("email", { emails: [] })).toThrow("at least one");
    expect(() => validateProviderConfig("email", { emails: ["notanemail"] })).toThrow("valid email");
    expect(() => validateProviderConfig("email", { emails: [1] })).toThrow("comma-separated");
    expect(() => validateProviderConfig("email", { emails: { a: 1 } })).toThrow("comma-separated");
    expect(normalizeProviderConfig("email", { emails: ["a@b.co", "c@d.io"] })).toEqual({ emails: "a@b.co,c@d.io" });
    // Blanks and stray commas never reach storage.
    expect(normalizeProviderConfig("email", { emails: ["a@b.co", " ", ""] })).toEqual({ emails: "a@b.co" });
    expect(normalizeProviderConfig("email", { emails: "a@b.co, ,c@d.io," })).toEqual({ emails: "a@b.co,c@d.io" });
    expect(() => validateProviderConfig("email", { emails: "a@b.co, c@d.io" })).not.toThrow();
  });

  it("allows integration auth headers for generic webhooks", () => {
    expect(() =>
      validateProviderConfig("webhook", {
        url: "https://api.atlassian.com/jsm/ops/integration/v2/alerts",
        method: "POST",
        preset: "jsm_ops",
        headers: {
          Authorization: "GenieKey test-key",
        },
      }),
    ).not.toThrow();
  });

  it("fills the vendor body template when a paging preset is saved without one", () => {
    // API, CLI and config-as-code callers send only `preset`; without a template the worker would post the Supercheck default payload, which no vendor accepts.
    const pagerduty = normalizeProviderConfig("webhook", { url: "https://events.pagerduty.com/v2/enqueue", preset: "pagerduty" });
    expect(JSON.parse(pagerduty.bodyTemplate as string)).toMatchObject({ event_action: "{{pagerDutyEventAction}}", dedup_key: "{{dedupKey}}" });
    // An explicit template wins, and custom webhooks keep the default payload.
    expect(normalizeProviderConfig("webhook", { url: "https://x.example.com", preset: "pagerduty", bodyTemplate: '{"a":1}' }).bodyTemplate).toBe('{"a":1}');
    expect(normalizeProviderConfig("webhook", { url: "https://x.example.com", preset: "custom" }).bodyTemplate).toBeUndefined();
    expect(normalizeProviderConfig("webhook", { url: "https://x.example.com" }).bodyTemplate).toBeUndefined();
  });

  it("rejects a preset saved with its stand-in credential still in place", () => {
    const url = "https://events.pagerduty.com/v2/enqueue";
    // API and CLI saves send only the preset; its default template still holds the placeholder routing key.
    expect(() => validateProviderConfig("webhook", { url, preset: "pagerduty" })).toThrow(
      "Replace REPLACE_WITH_PAGERDUTY_ROUTING_KEY in the webhook body template with your real value."
    );
    expect(() =>
      validateProviderConfig("webhook", { url, preset: "incident_io", headers: { Authorization: "Bearer REPLACE_WITH_INCIDENT_IO_TOKEN" } })
    ).toThrow("Replace REPLACE_WITH_INCIDENT_IO_TOKEN in the webhook headers with your real value.");
    expect(() =>
      validateProviderConfig("webhook", { url, preset: "pagerduty", bodyTemplate: '{"routing_key":"abc123","event_action":"trigger"}' })
    ).not.toThrow();
    expect(() => validateProviderConfig("webhook", { url, preset: "custom" })).not.toThrow();
    // Only the fixed placeholder name is echoed, never characters around it (stored headers are hidden from editors).
    expect(() =>
      validateProviderConfig("webhook", { url, preset: "custom", headers: { Authorization: "Bearer REPLACE_WITH_INCIDENT_IO_TOKENSECRET9" } })
    ).toThrow(/^Replace REPLACE_WITH_INCIDENT_IO_TOKEN in the webhook headers/);
    expect(() => validateProviderConfig("webhook", { url, preset: "custom", headers: { X: "REPLACE_WITH_ABC123" } })).toThrow(
      "Replace the REPLACE_WITH_ placeholder in the webhook headers with your real value."
    );
  });

  it("rejects the retired opsgenie preset like any unknown preset", () => {
    expect(() =>
      validateProviderConfig("webhook", {
        url: "https://api.opsgenie.com/v2/alerts",
        method: "POST",
        preset: "opsgenie",
      }),
    ).toThrow("Webhook preset is not supported.");
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

  // Keep in sync with worker notification.constants.spec.ts (same URL shapes).
  it.each([
    ["https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x", true],
    ["https://abc.12.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x/triggers/manual/paths/invoke?sig=x", true],
    ["https://contoso.webhook.office.com/webhookb2/abc", true],
    ["https://outlook.office.com/webhook/abc", false],
    ["https://evil.azurewebsites.net/hook", false],
    ["https://evilpowerplatform.com/hook", false],
  ])("teams save validator matches worker allowlist for %s", (url, ok) => {
    const run = () => validateProviderWebhookUrl(url, "teams", "Teams webhook URL");
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow();
  });
});
