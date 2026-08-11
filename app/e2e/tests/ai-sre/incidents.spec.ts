import { expect, test } from "../../fixtures/roles.fixture";

import { requireRbacUser } from "../../utils/env";
import { createMonitor, deleteMonitor } from "../../utils/test-data";

test.describe("AI SRE incident, brief, and investigation lifecycle @aisre @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("persists a manual incident, bounded brief, stored-evidence investigation, and legacy redirect", async ({
    orgOwnerPage: page,
  }) => {
    // This acceptance flow performs two bounded AI operations in addition to
    // the incident, evidence, download, and cleanup lifecycle.
    test.setTimeout(300_000);
    const projects = await page.request.get("/api/projects");
    expect(projects.status()).toBe(200);
    const originalProjectId = (
      (await projects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const createProject = await page.request.post("/api/projects", {
      data: { name: `E2E SRE incident lab ${Date.now()}` },
    });
    expect(createProject.status(), await createProject.text()).toBe(201);
    const projectId = ((await createProject.json()) as { data: { id: string } })
      .data.id;
    const switchProject = await page.request.post("/api/projects/switch", {
      data: { projectId },
    });
    expect(switchProject.status(), await switchProject.text()).toBe(200);
    let monitorId = "";

    try {
      const monitor = await createMonitor(page.request, {
        name: `E2E SRE alert source ${Date.now()}`,
        enabled: false,
      });
      monitorId = monitor.id;
      const alertMessage = `E2E actionable failure ${Date.now()}`;
      const alertResponse = await page.request.post("/api/alerts/history", {
        data: {
          type: "monitor_failure",
          message: alertMessage,
          target: monitor.name,
          targetType: "monitor",
          monitorId,
          provider: "email",
          status: "sent",
        },
      });
      expect(alertResponse.status(), await alertResponse.text()).toBe(200);

      await page.goto("/alerts?tab=signals", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Alert signals", exact: true }),
      ).toBeVisible();
      const signalRow = page.getByRole("row").filter({ hasText: alertMessage });
      await expect(signalRow).toContainText(monitor.name);
      await expect(signalRow).toContainText("sev2");
      await signalRow
        .getByRole("button", { name: "Create incident", exact: true })
        .click();
      await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/i);
      await expect(
        page.getByRole("heading", { name: new RegExp(monitor.name) }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page
          .getByText("Alerts", { exact: true })
          .locator("..")
          .filter({ hasText: /^Alerts1$/ }),
      ).toContainText("1");

      const promotedIncidentId = page.url().split("/").pop();
      expect(promotedIncidentId).toMatch(/^[0-9a-f-]{36}$/i);
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      await page
        .getByRole("button", { name: "Generate brief", exact: true })
        .click();
      await expect(
        page.getByText(/AI generated|Fallback brief/).first(),
      ).toBeVisible({
        timeout: 90_000,
      });
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download", exact: true }).click();
      const briefDownload = await downloadPromise;
      expect(briefDownload.suggestedFilename()).toMatch(
        /^incident-\d+-.+-brief\.md$/,
      );

      await page.getByRole("tab", { name: "Evidence", exact: true }).click();
      const evidenceRows = page.locator('tr[id^="sre-evidence-"]');
      await expect(evidenceRows.first()).toBeVisible();
      const evidenceId = (
        await evidenceRows.first().getAttribute("id")
      )?.replace("sre-evidence-", "");
      expect(evidenceId).toMatch(/^[0-9a-f-]{36}$/i);

      await page.goto("/copilot/evidence-graph", {
        waitUntil: "domcontentloaded",
      });
      await page.getByLabel("Map view").click();
      await page
        .getByRole("option", {
          name: "Investigations",
          exact: true,
        })
        .click();
      const evidenceNode = page.locator('[aria-label^="Evidence:"]').first();
      await expect(evidenceNode).toBeVisible({ timeout: 30_000 });
      await evidenceNode.click();
      const evidenceDetails = page.getByRole("link", { name: "View details" });
      await expect(evidenceDetails).toHaveAttribute(
        "href",
        `/incidents/${promotedIncidentId}#sre-evidence-${evidenceId}`,
      );
      await evidenceDetails.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/incidents/${promotedIncidentId}#sre-evidence-${evidenceId}$`,
        ),
      );
      await page.getByRole("tab", { name: "Evidence", exact: true }).click();
      await expect(page.locator(`#sre-evidence-${evidenceId}`)).toBeVisible();

      await page.getByRole("button", { name: "Open Copilot" }).click();
      const copilotDialog = page.getByRole("dialog", { name: "Copilot" });
      await expect(copilotDialog).toContainText(
        "Stored incident evidence with optional live sources.",
      );
      const liveSources = copilotDialog.getByRole("switch", {
        name: "Live sources",
      });
      await expect(liveSources).not.toBeChecked();
      await liveSources.click();
      await expect(liveSources).toBeChecked();
      const scopedPrompt = `Summarize stored and live evidence ${Date.now()}`;
      await copilotDialog
        .getByPlaceholder("Ask about this incident or its evidence...")
        .fill(scopedPrompt);
      const scopedResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/api/sre/chat/assistant-ui"),
      );
      await copilotDialog
        .getByRole("button", { name: "Send", exact: true })
        .click();
      const scopedResponse = await scopedResponsePromise;
      const scopedBody = scopedResponse.request().postDataJSON() as {
        incidentId?: string;
        useLiveConnectorTools?: boolean;
      };
      expect(scopedBody).toMatchObject({
        incidentId: promotedIncidentId,
        useLiveConnectorTools: true,
      });
      expect(scopedResponse.status(), await scopedResponse.text()).toBe(200);
      await expect(
        copilotDialog.getByLabel("User message").filter({
          hasText: scopedPrompt,
        }),
      ).toBeVisible();
      await expect(
        copilotDialog
          .locator('[aria-label="Copilot message"]:not(textarea)')
          .last(),
      ).not.toBeEmpty({
        timeout: 60_000,
      });

      const incidentTitle = `E2E SRE incident ${Date.now()}`;
      const initialNotes = "No root cause is asserted without cited evidence.";
      await page.goto("/incidents");
      await expect(
        page.getByRole("heading", { name: "Incidents", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("columnheader")).toHaveText([
        "ID",
        "Incident",
        "Severity",
        "Status",
        "Service",
        "Investigation",
        "Evidence",
        "Updated",
      ]);
      await page
        .getByRole("button", { name: "New incident", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Create incident" });
      await dialog.getByLabel("Title").fill(incidentTitle);
      await dialog.getByLabel("Initial notes").fill(initialNotes);
      await dialog
        .getByRole("button", { name: "Create incident", exact: true })
        .click();
      await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/i);
      const incidentId = page.url().split("/").pop();
      expect(incidentId).toMatch(/^[0-9a-f-]{36}$/i);
      await expect(
        page.getByRole("heading", { name: incidentTitle, exact: true }),
      ).toBeVisible();

      const tabs = page.getByRole("tab");
      await expect(tabs).toHaveCount(3);
      await expect(
        page.getByRole("tab", { name: "Investigation", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Evidence", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Brief", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Use live connector tools")).toBeDisabled();
      await expect(
        page.getByText("Primary service required", { exact: true }),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      await page
        .getByRole("button", { name: "Generate brief", exact: true })
        .click();
      await expect(
        page.getByText(/AI generated|Fallback brief/).first(),
      ).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText(/Confidence \d+%/).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible();

      await page.reload();
      await page.getByRole("tab", { name: "Brief", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible();

      await page
        .getByRole("tab", { name: "Investigation", exact: true })
        .click();
      const investigationResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/sre/investigate"),
      );
      await page
        .getByRole("button", { name: "Run investigation", exact: true })
        .click();
      const investigationResponse = await investigationResponsePromise;
      expect(
        investigationResponse.status(),
        await investigationResponse.text(),
      ).toBe(200);
      await expect(
        page.getByText("Latest result", { exact: true }),
      ).toBeVisible({ timeout: 120_000 });
      await expect(
        page.getByText(/completed|failed|error/i).last(),
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByText("Latest result", { exact: true }),
      ).toBeVisible();
      await page.goto("/copilot/investigations");
      await expect(page).toHaveURL(/\/incidents$/);
    } finally {
      if (monitorId) {
        await deleteMonitor(page.request, monitorId);
      }
      const restore = await page.request.post("/api/projects/switch", {
        data: { projectId: originalProjectId },
      });
      expect(restore.status(), await restore.text()).toBe(200);
      const remove = await page.request.delete(`/api/projects/${projectId}`);
      expect([200, 404]).toContain(remove.status());
    }
  });
});
