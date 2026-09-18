import { createNotificationProviderSchema } from "./notification-provider-form";

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
