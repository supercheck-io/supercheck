import {
  WEBHOOK_TEST_PAYLOAD,
  buildWebhookPayloadPreview,
  buildWebhookTestBody,
} from "@/lib/notification-providers/webhook-preview";

describe("webhook-preview", () => {
  it("does not build a body for GET webhook tests", () => {
    expect(buildWebhookTestBody({ method: "GET", bodyTemplate: "" })).toBeUndefined();

    expect(
      buildWebhookPayloadPreview({ method: "GET", bodyTemplate: "" }),
    ).toMatchObject({
      method: "GET",
      hasBody: false,
      usesTemplate: false,
    });
  });

  it("uses the default test payload when no body template is configured", () => {
    const body = buildWebhookTestBody({ method: "POST", bodyTemplate: "" });

    expect(JSON.parse(body || "{}")).toEqual(WEBHOOK_TEST_PAYLOAD);
  });

  it("renders a formatted preview with sample alert variables", () => {
    const preview = buildWebhookPayloadPreview({
      method: "POST",
      bodyTemplate: JSON.stringify({
        summary: "{{title}}",
        severity: "{{normalizedSeverity}}",
        dedup_key: "{{dedupKey}}",
      }),
    });

    const parsedBody = JSON.parse(preview.body || "{}") as {
      summary?: string;
      severity?: string;
      dedup_key?: string;
    };

    expect(preview.error).toBeUndefined();
    expect(preview.usesTemplate).toBe(true);
    expect(parsedBody.summary).toBe('Test "Alert"');
    expect(parsedBody.severity).toBe("error");
    expect(parsedBody.dedup_key).toBe("monitor:test-target-id");
  });

  it("returns a preview error for invalid JSON templates", () => {
    const preview = buildWebhookPayloadPreview({
      method: "POST",
      bodyTemplate: '{"summary": {{title}}}',
    });

    expect(preview.hasBody).toBe(true);
    expect(preview.error).toBe("Body template must be valid JSON");
  });
});
