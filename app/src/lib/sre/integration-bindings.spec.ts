import {
  canBindIntegrationToConnector,
  describeIntegrationBindingCompatibility,
  getDefaultCorrelationStrategy,
  getNotificationProviderIntegrationKey,
} from "@/lib/sre/integration-bindings";

describe("integration-bindings", () => {
  it("maps webhook presets to explicit integration keys", () => {
    expect(
      getNotificationProviderIntegrationKey({
        type: "webhook",
        config: { preset: "pagerduty", url: "https://events.pagerduty.com/v2/enqueue" },
      }),
    ).toBe("pagerduty");

    expect(
      getNotificationProviderIntegrationKey({
        type: "webhook",
        config: { preset: "custom", url: "https://example.com/alerts" },
      }),
    ).toBe("generic_webhook");
  });

  it("maps native chat notification providers to thread-capable integrations", () => {
    expect(
      getNotificationProviderIntegrationKey({
        type: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/test" },
      }),
    ).toBe("slack");
    expect(getDefaultCorrelationStrategy("slack")).toBe("thread");
  });

  it("accepts compatible read-only connector bindings", () => {
    expect(
      describeIntegrationBindingCompatibility({
        providerType: "webhook",
        providerConfig: { preset: "opsgenie" },
        connectorType: "opsgenie",
      }),
    ).toEqual({
      bindable: true,
      integrationKey: "opsgenie",
      correlationStrategy: "alias",
    });
  });

  it("rejects unsupported provider and connector combinations", () => {
    expect(
      describeIntegrationBindingCompatibility({
        providerType: "email",
        providerConfig: { emails: "sre@example.com" },
        connectorType: "pagerduty",
      }),
    ).toMatchObject({
      bindable: false,
      integrationKey: null,
    });

    expect(
      describeIntegrationBindingCompatibility({
        providerType: "webhook",
        providerConfig: { preset: "pagerduty" },
        connectorType: "opsgenie",
      }),
    ).toMatchObject({
      bindable: false,
      integrationKey: "pagerduty",
    });
  });

  it("cannot bind chat or generic webhook integrations to any connector", () => {
    for (const integrationKey of ["slack", "teams", "better_stack", "incident_io", "generic_webhook"] as const) {
      for (const connectorType of ["pagerduty", "opsgenie", "splunk", "webhook", "slack"]) {
        expect(canBindIntegrationToConnector(integrationKey, connectorType)).toBe(false);
      }
    }
    expect(canBindIntegrationToConnector("splunk_on_call", "splunk")).toBe(true);
  });
});
