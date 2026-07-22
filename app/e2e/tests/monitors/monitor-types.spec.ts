import { expect } from "@playwright/test";

import { test } from "../../fixtures";
import {
  createMonitor,
  createTest,
  deleteMonitor,
  deleteTest,
} from "../../utils/test-data";

test.describe("Monitor type persistence @monitors @critical", () => {
  test("persists website SSL, ping, TCP port, and synthetic test configurations", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const page = projectAdminPage;
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const syntheticTest = await createTest(request, {
      title: `E2E synthetic source ${suffix}`,
    });
    cleanup.add(`synthetic source test ${syntheticTest.id}`, () =>
      deleteTest(request, syntheticTest.id),
    );

    const definitions = [
      {
        name: `E2E website ${suffix}`,
        type: "website",
        target: "https://example.com/",
        config: { enableSslCheck: true, sslDaysUntilExpirationWarning: 14 },
      },
      {
        name: `E2E ping ${suffix}`,
        type: "ping_host",
        target: "1.1.1.1",
        config: { timeoutSeconds: 5 },
      },
      {
        name: `E2E port ${suffix}`,
        type: "port_check",
        target: "example.com",
        config: { port: 443, protocol: "tcp", timeoutSeconds: 5 },
      },
      {
        name: `E2E synthetic ${suffix}`,
        type: "synthetic_test",
        target: syntheticTest.id,
        config: { testId: syntheticTest.id },
      },
    ] as const;

    for (const definition of definitions) {
      const monitor = await createMonitor(request, definition);
      cleanup.add(`monitor ${monitor.id}`, () =>
        deleteMonitor(request, monitor.id),
      );
      const response = await request.get(`/api/monitors/${monitor.id}`);
      expect(response.status(), await response.text()).toBe(200);
      expect(await response.json()).toMatchObject({
        id: monitor.id,
        name: definition.name,
        type: definition.type,
        target: definition.target,
        config: definition.config,
        frequencyMinutes: 5,
      });

      await page.goto(`/monitors/${monitor.id}`, { waitUntil: "load" });
      await expect(
        page.getByRole("heading", { name: definition.name, exact: true }),
      ).toBeVisible();
    }
  });

  test("rejects malformed create and update configuration without mutating data", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const invalidPort = await request.post("/api/monitors", {
      data: {
        name: `E2E invalid port ${Date.now()}`,
        type: "port_check",
        target: "example.com",
        frequencyMinutes: 5,
        config: { port: 70000, protocol: "tcp" },
      },
    });
    if (invalidPort.status() === 201) {
      const leakedMonitor = (await invalidPort.json()) as { id: string };
      cleanup.add(`regression monitor ${leakedMonitor.id}`, () =>
        deleteMonitor(request, leakedMonitor.id),
      );
    }
    expect(invalidPort.status(), await invalidPort.text()).toBe(400);
    expect(await invalidPort.json()).toMatchObject({
      error: expect.any(String),
    });

    const invalidSynthetic = await request.post("/api/monitors", {
      data: {
        name: `E2E invalid synthetic ${Date.now()}`,
        type: "synthetic_test",
        target: "",
        frequencyMinutes: 5,
        config: {},
      },
    });
    expect(invalidSynthetic.status(), await invalidSynthetic.text()).toBe(400);
    expect(await invalidSynthetic.json()).toMatchObject({
      error: expect.any(String),
    });

    const validMonitor = await createMonitor(request, {
      name: `E2E update guard ${Date.now()}`,
      type: "port_check",
      target: "example.com",
      config: { port: 443, protocol: "tcp", timeoutSeconds: 5 },
    });
    cleanup.add(`monitor ${validMonitor.id}`, () =>
      deleteMonitor(request, validMonitor.id),
    );

    const invalidUpdate = await request.put(
      `/api/monitors/${validMonitor.id}`,
      {
        data: { config: { port: 0, protocol: "tcp", timeoutSeconds: 5 } },
      },
    );
    expect(invalidUpdate.status(), await invalidUpdate.text()).toBe(400);

    const persisted = await request.get(`/api/monitors/${validMonitor.id}`);
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({
      id: validMonitor.id,
      config: { port: 443, protocol: "tcp", timeoutSeconds: 5 },
    });
  });
});
