import { expect } from "@playwright/test";

import { test } from "../../fixtures";

test.describe("CLI project-config deployment @api @cli @critical", () => {
  test("rejects redacted snapshots and keeps dry-run non-mutating before explicit apply", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const providerName = `E2E CLI provider ${suffix}`;
    const recipient = `cli-${suffix}@e2e-test.supercheck.io`;
    const explicitProvider = {
      name: providerName,
      type: "email",
      enabled: true,
      config: { name: providerName, emails: [recipient] },
    };

    const redacted = await request.post("/api/cli/project-config/deploy", {
      data: {
        mode: "apply",
        schemaVersion: 1,
        hashVersion: 1,
        notificationProviders: [
          {
            name: providerName,
            type: "email",
            configSummary: { fieldNames: ["emails"], redacted: true },
          },
        ],
      },
    });
    expect(redacted.status(), await redacted.text()).toBe(400);
    expect(await redacted.json()).toMatchObject({
      success: false,
      mode: "apply",
      errors: expect.arrayContaining([
        {
          path: "$",
          message:
            "Redacted project-config snapshots cannot be deployed. Send an explicit deploy payload with full provider config values.",
        },
        {
          path: "$.notificationProviders[0].configSummary",
          message:
            "Redacted configSummary is pull/diff output only and cannot be deployed.",
        },
      ]),
    });

    const dryRun = await request.post("/api/cli/project-config/deploy", {
      data: {
        mode: "dry_run",
        notificationProviders: [explicitProvider],
        sreIntegrationBindings: [],
      },
    });
    expect(dryRun.status(), await dryRun.text()).toBe(200);
    const dryBody = await dryRun.json();
    expect(dryBody).toEqual({
      success: true,
      mode: "dry_run",
      warnings: [
        "Dry-run only: no notification providers or SRE bindings were modified.",
        "Deploy payloads must include explicit secret values. Redacted pull/diff snapshots are rejected to prevent secret erasure.",
      ],
      plan: {
        mode: "dry_run",
        notificationProviders: [
          {
            index: 0,
            id: null,
            name: providerName,
            type: "email",
            enabled: true,
            action: "create",
            configFieldNames: ["emails", "name"],
          },
        ],
        sreIntegrationBindings: [],
      },
    });
    expect(JSON.stringify(dryBody)).not.toContain(recipient);

    const afterDryRun = await request.get("/api/notification-providers");
    expect(afterDryRun.status(), await afterDryRun.text()).toBe(200);
    expect(
      ((await afterDryRun.json()) as Array<{ name: string }>).filter(
        (provider) => provider.name === providerName,
      ),
    ).toEqual([]);

    const apply = await request.post("/api/cli/project-config/deploy", {
      data: {
        mode: "apply",
        notificationProviders: [explicitProvider],
        sreIntegrationBindings: [],
      },
    });
    expect(apply.status(), await apply.text()).toBe(200);
    const applied = (await apply.json()) as {
      success: boolean;
      mode: string;
      applied: { notificationProviders: Array<{ id: string; action: string }> };
    };
    expect(applied).toMatchObject({
      success: true,
      mode: "apply",
      applied: {
        notificationProviders: [
          { id: expect.stringMatching(/^[0-9a-f-]{36}$/i), action: "created" },
        ],
      },
    });
    const providerId = applied.applied.notificationProviders[0].id;
    cleanup.add(`CLI notification provider ${providerId}`, async () => {
      const response = await request.delete(
        `/api/notification-providers/${providerId}`,
      );
      if (![200, 404].includes(response.status())) {
        throw new Error(
          `CLI provider cleanup failed (${response.status()}): ${await response.text()}`,
        );
      }
    });

    const persisted = await request.get(
      `/api/notification-providers/${providerId}`,
    );
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({
      id: providerId,
      name: providerName,
      type: "email",
      config: { name: providerName, emails: [recipient] },
    });
  });

  test("requires authentication for deploy preflight and apply", async ({
    playwright,
    baseURL,
  }) => {
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const mode of ["dry_run", "apply"]) {
        const response = await anonymous.post(
          "/api/cli/project-config/deploy",
          {
            data: {
              mode,
              notificationProviders: [],
              sreIntegrationBindings: [],
            },
          },
        );
        expect(response.status(), await response.text()).toBe(401);
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
