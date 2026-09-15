import { analyzeCliProjectConfigDeployRequest } from "./project-config-deploy";

describe("CLI project config deploy preflight", () => {
  it("rejects redacted pull/diff snapshots before deploy", () => {
    const result = analyzeCliProjectConfigDeployRequest({
      schemaVersion: 1,
      hashVersion: "hmac-sha256:v1",
      notificationProviders: [
        {
          id: "provider-1",
          name: "PagerDuty",
          type: "webhook",
          enabled: true,
          configSummary: {
            secretHandling: "redacted",
            endpointConfigured: true,
            endpointFingerprint: "abc123",
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$",
          message: expect.stringContaining("cannot be deployed"),
        }),
        expect.objectContaining({
          path: "$.notificationProviders[0].configSummary",
          message: expect.stringContaining("cannot be deployed"),
        }),
        expect.objectContaining({
          path: "$.notificationProviders[0].config",
          message: expect.stringContaining("Explicit provider config is required"),
        }),
      ]),
    );
    expect(JSON.stringify(result.plan)).not.toContain("abc123");
  });

  it("accepts explicit webhook deploy config and returns a redacted dry-run plan", () => {
    const result = analyzeCliProjectConfigDeployRequest({
      mode: "dry_run",
      notificationProviders: [
        {
          id: "provider-1",
          name: "PagerDuty",
          type: "webhook",
          enabled: true,
          config: {
            preset: "pagerduty",
            url: "https://events.pagerduty.com/v2/enqueue",
            method: "POST",
            headers: {
              Authorization: "Token secret-value",
            },
            bodyTemplate: '{"routing_key":"secret-routing-key"}',
          },
        },
      ],
      sreIntegrationBindings: [
        {
          integrationKey: "pagerduty",
          correlationStrategy: "dedup_key",
          enabled: true,
          notificationProviderId: "provider-1",
          externalConnectorId: "connector-1",
          serviceIds: ["service-b", "service-a", "service-a"],
        },
      ],
    });

    const serializedPlan = JSON.stringify(result.plan);

    expect(result.valid).toBe(true);
    expect(result.plan.notificationProviders).toEqual([
      {
        index: 0,
        id: "provider-1",
        name: "PagerDuty",
        type: "webhook",
        enabled: true,
        action: "update",
        configFieldNames: ["bodyTemplate", "headers", "method", "preset", "url"],
      },
    ]);
    expect(result.plan.sreIntegrationBindings[0]).toMatchObject({
      serviceIds: ["service-a", "service-b"],
      action: "create",
    });
    expect(result.warnings[0]).toContain("Dry-run only");
    expect(serializedPlan).not.toContain("secret-value");
    expect(serializedPlan).not.toContain("secret-routing-key");
  });

  it("accepts apply mode for explicit deploy payloads", () => {
    const result = analyzeCliProjectConfigDeployRequest({
      mode: "apply",
      notificationProviders: [
        {
          name: "Slack",
          type: "slack",
          enabled: true,
          config: {
            webhookUrl: "https://hooks.slack.com/services/T000/B000/SECRET",
          },
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.plan).toMatchObject({
      mode: "apply",
      notificationProviders: [
        {
          action: "create",
          name: "Slack",
          type: "slack",
        },
      ],
    });
  });

  it("rejects snapshot binding connector objects", () => {
    const result = analyzeCliProjectConfigDeployRequest({
      mode: "apply",
      sreIntegrationBindings: [
        {
          id: "binding-1",
          integrationKey: "pagerduty",
          correlationStrategy: "dedup_key",
          enabled: true,
          notificationProviderId: "provider-1",
          externalConnector: {
            id: "connector-1",
            type: "pagerduty",
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.sreIntegrationBindings[0].externalConnector",
          message: expect.stringContaining("cannot be deployed"),
        }),
        expect.objectContaining({
          path: "$.sreIntegrationBindings[0].externalConnectorId",
          message: "Expected a non-empty string.",
        }),
      ]),
    );
  });
});
