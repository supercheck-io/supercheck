import {
  buildCliProjectConfigSnapshot,
  serializeNotificationProviderForCli,
  serializeSreIntegrationBindingForCli,
} from "./project-config";

describe("CLI project config snapshot", () => {
  const hashKey = "test-hash-key";

  it("redacts webhook endpoints, headers, and body templates while preserving diff metadata", () => {
    const provider = serializeNotificationProviderForCli(
      {
        id: "provider-1",
        name: "PagerDuty",
        type: "webhook",
        isEnabled: true,
        config: {
          preset: "pagerduty",
          url: "https://events.pagerduty.com/v2/enqueue/secret-token",
          method: "POST",
          headers: {
            Authorization: "GenieKey secret-api-key",
            "X-Team": "platform",
          },
          bodyTemplate: '{"routing_key":"secret-routing-key"}',
        },
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: new Date("2026-01-03T03:04:05.000Z"),
      },
      hashKey,
    );

    const serialized = JSON.stringify(provider);

    expect(provider.configSummary).toMatchObject({
      secretHandling: "redacted",
      preset: "pagerduty",
      method: "POST",
      endpointConfigured: true,
      headersConfigured: true,
      headerNames: ["Authorization", "X-Team"],
      bodyTemplateConfigured: true,
    });
    expect(provider.configSummary.endpointFingerprint).toEqual(expect.any(String));
    expect(provider.configSummary.bodyTemplateFingerprint).toEqual(expect.any(String));
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("secret-routing-key");
    expect(serialized).not.toContain("platform");
  });

  it("serializes SRE bindings without connector credentials or mutable ordering", () => {
    const binding = serializeSreIntegrationBindingForCli({
      id: "binding-1",
      integrationKey: "pagerduty",
      correlationStrategy: "dedup_key",
      enabled: true,
      notificationProviderId: "provider-1",
      externalConnectorId: "connector-1",
      externalConnectorName: "PagerDuty read-only",
      externalConnectorType: "pagerduty",
      externalConnectorStatus: "valid",
      serviceIds: ["service-b", "service-a"],
      createdAt: null,
      updatedAt: new Date("2026-01-03T03:04:05.000Z"),
    });

    expect(binding).toEqual({
      id: "binding-1",
      integrationKey: "pagerduty",
      correlationStrategy: "dedup_key",
      enabled: true,
      notificationProviderId: "provider-1",
      externalConnector: {
        id: "connector-1",
        name: "PagerDuty read-only",
        type: "pagerduty",
        status: "valid",
      },
      serviceIds: ["service-a", "service-b"],
      createdAt: null,
      updatedAt: "2026-01-03T03:04:05.000Z",
    });
  });

  it("builds a versioned project snapshot for CLI pull and diff workflows", () => {
    const snapshot = buildCliProjectConfigSnapshot({
      generatedAt: new Date("2026-01-04T03:04:05.000Z"),
      hashKey,
      organization: {
        id: "org-1",
        name: "Acme",
        slug: "acme",
      },
      project: {
        id: "project-1",
        name: "Production",
        slug: "prod",
      },
      notificationProviders: [
        {
          id: "slack-1",
          name: "Slack",
          type: "slack",
          isEnabled: false,
          config: {
            webhookUrl: "https://hooks.slack.com/services/secret",
            channel: "#alerts",
          },
          createdAt: null,
          updatedAt: null,
        },
      ],
      sreIntegrationBindings: [],
    });

    const serialized = JSON.stringify(snapshot);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.hashVersion).toBe("hmac-sha256:v1");
    expect(snapshot.generatedAt).toBe("2026-01-04T03:04:05.000Z");
    expect(snapshot.notificationProviders[0]).toMatchObject({
      id: "slack-1",
      enabled: false,
      configSummary: {
        secretHandling: "redacted",
        webhookUrlConfigured: true,
        channelConfigured: true,
      },
    });
    expect(snapshot.warnings[0]).toContain("redacted");
    expect(serialized).not.toContain("hooks.slack.com");
    expect(serialized).not.toContain("#alerts");
  });
});
