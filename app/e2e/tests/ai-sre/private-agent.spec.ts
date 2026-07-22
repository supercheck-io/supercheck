import { expect } from "@playwright/test";

import { test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";

const exchangePayload = (agentId: string) => ({
  agentId,
  protocolVersion: "1",
  agentVersion: "e2e-1.0.0",
  capabilities: {
    supportsSreConnectors: true,
    supportsHttpMonitoring: false,
    supportsPlaywright: false,
    supportsK6: false,
    supportsNetworkChecks: false,
  },
});

test.describe("AI SRE Private Agent lifecycle @aisre @private-agent @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("enforces one-time registration, heartbeat identity, rotation revocation, and disable", async ({
    orgOwnerPage: page,
  }) => {
    const projects = await page.request.get("/api/projects");
    expect(projects.status(), await projects.text()).toBe(200);
    const originalProjectId = (
      (await projects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const createdProject = await page.request.post("/api/projects", {
      data: { name: `E2E Private Agent ${Date.now()}` },
    });
    expect(createdProject.status(), await createdProject.text()).toBe(201);
    const projectId = (
      (await createdProject.json()) as { data: { id: string } }
    ).data.id;
    const switched = await page.request.post("/api/projects/switch", {
      data: { projectId },
    });
    expect(switched.status(), await switched.text()).toBe(200);

    try {
      const agentName = `E2E agent ${Date.now()}`;
      await page.goto("/org-admin?tab=private-agents", { waitUntil: "load" });
      await page
        .getByRole("button", { name: "Register agent", exact: true })
        .first()
        .click();
      const registerDialog = page.getByRole("dialog", {
        name: "Register Private Agent",
      });
      await registerDialog.getByLabel("Agent name *").fill(agentName);
      await registerDialog.getByLabel("Region").fill("e2e-region");
      await registerDialog
        .getByLabel("Network label")
        .fill("isolated-e2e-network");
      await registerDialog
        .getByRole("button", { name: "Register agent", exact: true })
        .click();

      const agentId = await registerDialog.getByLabel("Agent ID").inputValue();
      const registrationToken = await registerDialog
        .getByLabel("Registration token")
        .inputValue();
      expect(agentId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(registrationToken).toMatch(/^scpa_/);
      await registerDialog
        .getByRole("button", { name: "Done", exact: true })
        .click();

      const exchange = await page.request.post(
        "/api/private-agents/registration/exchange",
        {
          headers: { Authorization: `Bearer ${registrationToken}` },
          data: exchangePayload(agentId),
        },
      );
      expect(exchange.status(), await exchange.text()).toBe(200);
      const runtime = (await exchange.json()) as {
        token: string;
        keyId: string;
        agent: { id: string; status: string };
      };
      expect(runtime).toMatchObject({
        token: expect.stringMatching(/^scpac_/),
        keyId: expect.stringMatching(/^pa_/),
        agent: { id: agentId, status: "connected" },
      });

      const replay = await page.request.post(
        "/api/private-agents/registration/exchange",
        {
          headers: { Authorization: `Bearer ${registrationToken}` },
          data: exchangePayload(agentId),
        },
      );
      expect(replay.status(), await replay.text()).toBe(401);

      const heartbeatData = {
        ...exchangePayload(agentId),
        status: "connected",
        activeJobCount: 0,
        latencyMs: 7,
      };
      const heartbeat = await page.request.post(
        "/api/private-agents/heartbeat",
        {
          headers: { Authorization: `Bearer ${runtime.token}` },
          data: heartbeatData,
        },
      );
      expect(heartbeat.status(), await heartbeat.text()).toBe(200);
      expect(await heartbeat.json()).toMatchObject({
        ok: true,
        receivedAt: expect.any(String),
      });

      const mismatched = await page.request.post(
        "/api/private-agents/heartbeat",
        {
          headers: { Authorization: `Bearer ${runtime.token}` },
          data: {
            ...heartbeatData,
            agentId: "01900000-0000-7000-8000-000000000000",
          },
        },
      );
      expect(mismatched.status(), await mismatched.text()).toBe(401);

      await page.reload();
      const row = page.getByRole("row").filter({ hasText: agentName });
      await expect(row).toContainText("connected");
      await expect(row).toContainText("e2e-region");
      await row
        .getByRole("button", { name: `Open actions for ${agentName}` })
        .click();
      await page
        .getByRole("menuitem", { name: "Rotate token", exact: true })
        .click();
      const rotatedDialog = page.getByRole("dialog", { name: "Token rotated" });
      const rotatedRegistrationToken = await rotatedDialog
        .locator("input")
        .inputValue();
      expect(rotatedRegistrationToken).toMatch(/^scpa_/);
      expect(rotatedRegistrationToken).not.toBe(registrationToken);

      const revokedHeartbeat = await page.request.post(
        "/api/private-agents/heartbeat",
        {
          headers: { Authorization: `Bearer ${runtime.token}` },
          data: heartbeatData,
        },
      );
      expect(revokedHeartbeat.status(), await revokedHeartbeat.text()).toBe(
        401,
      );
      await rotatedDialog
        .getByRole("button", { name: "Done", exact: true })
        .click();

      await row
        .getByRole("button", { name: `Open actions for ${agentName}` })
        .click();
      await page
        .getByRole("menuitem", { name: "Disable agent", exact: true })
        .click();
      const disableDialog = page.getByRole("alertdialog", {
        name: "Disable Private Agent?",
      });
      await disableDialog
        .getByRole("button", { name: "Disable agent", exact: true })
        .click();
      await expect(row).toContainText("disabled");
    } finally {
      const restored = await page.request.post("/api/projects/switch", {
        data: { projectId: originalProjectId },
      });
      expect(restored.status(), await restored.text()).toBe(200);
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      expect([200, 404]).toContain(removed.status());
    }
  });
});
