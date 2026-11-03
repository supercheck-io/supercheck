import { expect, test } from "../../fixtures/roles.fixture";

import { requireRbacUser } from "../../utils/env";
import { createMonitor, deleteMonitor } from "../../utils/test-data";

import type { Page } from "@playwright/test";

// The root hydration flag can fire before nested Suspense boundaries hydrate, so
// a first click on a fresh page may be dropped: retry until the sheet is open.
async function openInvestigationSheet(page: Page, tab: string | RegExp) {
  const sheet = page.getByRole("dialog", { name: "Investigation details" });
  const trigger = page
    .getByRole("button", { name: /^(Investigate|Investigation details)$/ })
    .first();
  await expect(async () => {
    if (!(await sheet.isVisible())) await trigger.click();
    await expect(sheet).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await sheet.getByRole("tab", { name: tab }).click();
  return sheet;
}

test.describe("AI SRE incident, brief, and investigation lifecycle @aisre @critical", () => {
  test.beforeAll(() => {
    requireRbacUser("orgOwner");
    requireRbacUser("viewer");
  });

  test("persists a manual incident, bounded brief, stored-evidence investigation, and legacy redirect", async ({
    orgOwnerPage: page,
    viewerPage,
  }) => {
    // This acceptance flow performs two bounded AI operations in addition to
    // the incident, evidence, download, and cleanup lifecycle.
    test.setTimeout(300_000);
    const projects = await page.request.get("/api/projects");
    expect(projects.status()).toBe(200);
    const originalProjectId = (
      (await projects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const viewerProjects = await viewerPage.request.get("/api/projects");
    expect(viewerProjects.status(), await viewerProjects.text()).toBe(200);
    const viewerOriginalProjectId = (
      (await viewerProjects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const createProject = await page.request.post("/api/projects", {
      data: { name: `E2E SRE incident lab ${Date.now()}` },
    });
    expect(createProject.status(), await createProject.text()).toBe(201);
    const projectId = ((await createProject.json()) as { data: { id: string } })
      .data.id;
    let monitorId = "";

    try {
      // Switch inside the try so a failed selection still cleans up the project.
      const switchProject = await page.request.post("/api/projects/switch", {
        data: { projectId },
      });
      expect(switchProject.status(), await switchProject.text()).toBe(200);

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

      await page.goto("/notifications?tab=history", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("tab", { name: "Delivery history", exact: true }),
      ).toBeVisible();
      const alertRow = page.getByRole("row").filter({ hasText: monitor.name }).first();
      // The SRE worker opens the incident asynchronously: the row shows "#N" once it has, else the promote button (idempotent).
      await alertRow
        .getByRole("link", { name: /^#\d+$/ })
        .or(alertRow.getByRole("button", { name: `Open incident for ${monitor.name}`, exact: true }))
        .first()
        .click();
      await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/i);
      await expect(
        page.getByRole("heading", { name: new RegExp(monitor.name) }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("heading", { name: /^Alerts\s*1$/ }),
      ).toBeVisible();

      const promotedIncidentId = page.url().split("/").pop();
      expect(promotedIncidentId).toMatch(/^[0-9a-f-]{36}$/i);
      const briefSheet = await openInvestigationSheet(page, "Brief");
      await briefSheet
        .getByRole("button", { name: "Generate brief", exact: true })
        .click();
      await expect(
        briefSheet.getByText(/AI generated|Fallback brief/).first(),
      ).toBeVisible({
        timeout: 90_000,
      });
      const downloadPromise = page.waitForEvent("download");
      await briefSheet
        .getByRole("button", { name: "Download", exact: true })
        .click();
      const briefDownload = await downloadPromise;
      expect(briefDownload.suggestedFilename()).toMatch(
        /^incident-\d+-.+-brief\.md$/,
      );
      await briefSheet.getByRole("tab", { name: /^Evidence/ }).click();
      const evidenceRows = briefSheet.locator('tr[id^="sre-evidence-"]');
      await expect(evidenceRows.first()).toBeVisible();
      const evidenceId = (
        await evidenceRows.first().getAttribute("id")
      )?.replace("sre-evidence-", "");
      expect(evidenceId).toMatch(/^[0-9a-f-]{36}$/i);

      // Evidence rows live in the investigation sheet; ?tab=evidence opens it.
      await page.goto(`/incidents/${promotedIncidentId}?tab=evidence#sre-evidence-${evidenceId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator(`#sre-evidence-${evidenceId}`)).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByTestId("investigation-sheet")).toBeHidden();
      const askCopilot = page.getByRole("menuitem", {
        name: "Ask Copilot",
        exact: true,
      });
      await expect(async () => {
        if (!(await askCopilot.isVisible())) {
          await page.getByRole("button", { name: "More actions" }).click();
        }
        await expect(askCopilot).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      await askCopilot.click();
      await expect(page).toHaveURL(
        new RegExp(`/copilot\\?incident=${promotedIncidentId}$`),
      );
      await expect(
        page.getByText("Scoped to this incident. Answers cite saved evidence.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`/copilot\\?incident=${promotedIncidentId}$`),
      );
      await page.reload();
      await expect(
        page.getByPlaceholder("Ask about this incident or its evidence..."),
      ).toBeEnabled();
      const liveSources = page.getByRole("switch", {
        name: "Live sources",
      });
      await expect(liveSources).toBeChecked();
      await liveSources.click();
      await expect(liveSources).not.toBeChecked();
      await liveSources.click();
      await expect(liveSources).toBeChecked();
      const scopedPrompt = `Summarize stored and live evidence ${Date.now()}`;
      await page
        .getByPlaceholder("Ask about this incident or its evidence...")
        .fill(scopedPrompt);
      const scopedResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/api/sre/chat/assistant-ui"),
      );
      await page.getByRole("button", { name: "Send", exact: true }).click();
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
        page.getByLabel("User message").filter({
          hasText: scopedPrompt,
        }),
      ).toBeVisible();
      await expect(
        page.locator('[aria-label="Copilot message"]:not(textarea)').last(),
      ).not.toBeEmpty({
        timeout: 60_000,
      });

      const incidentTitle = `E2E SRE incident ${Date.now()}`;
      const initialNotes = "No root cause is asserted without cited evidence.";
      await page.goto("/incidents");
      await expect(
        page.getByRole("heading", { name: "Incidents", exact: true }),
      ).toBeVisible();
      // Severity and Status headers carry info-tip text, so match prefixes in exact order.
      await expect(page.getByRole("columnheader")).toHaveText([
        /^#/, /^Title/, /^Severity/, /^Status/, /^Service/, /^Assignee/, /^Age/, /^AI/,
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
        page.getByRole("heading", { name: new RegExp(incidentTitle) }),
      ).toBeVisible();

      await expect(page.getByTestId("incident-ai-summary")).toBeVisible();
      const sheet = await openInvestigationSheet(page, "Analysis");
      await expect(sheet.getByRole("tab")).toContainText(["Analysis", "Evidence", "Brief"]);
      await expect(sheet.getByLabel("Include live sources")).toBeDisabled();
      await expect(
        sheet.getByText("Link a service to use live sources.", { exact: false }),
      ).toBeVisible();
      await sheet.getByRole("tab", { name: "Brief", exact: true }).click();
      await sheet
        .getByRole("button", { name: "Generate brief", exact: true })
        .click();
      await expect(
        sheet.getByText(/AI generated|Fallback brief/).first(),
      ).toBeVisible({ timeout: 90_000 });
      await expect(sheet.getByText(/^Confidence: (High|Medium|Low|Inconclusive)$/).first()).toBeVisible();
      await expect(
        sheet.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible();

      await page.reload();
      const reloadedSheet = await openInvestigationSheet(page, "Brief");
      await expect(
        reloadedSheet.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible();

      await reloadedSheet.getByRole("tab", { name: "Analysis", exact: true }).click();
      const investigationResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/sre/investigate"),
      );
      await reloadedSheet
        .getByRole("button", { name: "Run investigation", exact: true })
        .click();
      const investigationResponse = await investigationResponsePromise;
      expect([200, 202], await investigationResponse.text()).toContain(
        investigationResponse.status(),
      );
      // The run may finish asynchronously (202); the snapshot control only
      // offers its button once the run has completed.
      await expect(
        reloadedSheet.getByRole("heading", { name: "Report snapshot" }),
      ).toBeVisible({ timeout: 120_000 });
      await reloadedSheet
        .getByRole("button", { name: "Save report snapshot", exact: true })
        .click({ timeout: 120_000 });
      await expect(reloadedSheet.getByText(/^Snapshot saved/)).toBeVisible();
      await page.keyboard.press("Escape");

      // Feedback now lives on the AI summary card as Right/Wrong plus a note.
      const summaryCard = page.getByTestId("incident-ai-summary");
      const rightButton = summaryCard.getByRole("button", {
        name: "Right: this investigation",
      });
      const feedbackNote = summaryCard.getByLabel("Optional one-line note");
      await expect(async () => {
        if (!(await feedbackNote.isVisible())) await rightButton.click();
        await expect(feedbackNote).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      const note = `E2E feedback ${Date.now()}`;
      await feedbackNote.fill(note);
      await summaryCard.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByText("Thanks, feedback saved", { exact: true }),
      ).toBeVisible();

      await page.reload();
      const persistedRight = page
        .getByTestId("incident-ai-summary")
        .getByRole("button", { name: "Right: this investigation" });
      await expect(persistedRight).toHaveAttribute("aria-pressed", "true");
      // The saved note is shown in the verdict tooltip.
      await persistedRight.hover();
      await expect(page.getByRole("tooltip")).toContainText(`You marked this right: ${note}`);
      const persistedSheet = await openInvestigationSheet(page, "Analysis");
      await expect(persistedSheet.getByText(/^Snapshot saved/)).toBeVisible();

      const viewerSwitch = await viewerPage.request.post(
        "/api/projects/switch",
        { data: { projectId } },
      );
      expect(viewerSwitch.status(), await viewerSwitch.text()).toBe(200);
      await viewerPage.goto(`/incidents/${incidentId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        viewerPage.getByRole("heading", { name: new RegExp(incidentTitle) }),
      ).toBeVisible({ timeout: 30_000 });
      for (const name of ["More actions", "Acknowledge"]) {
        await expect(
          viewerPage.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      }
      await expect(
        viewerPage.getByRole("group", { name: "Feedback on this investigation" }),
      ).toHaveCount(0);
      const viewerSheet = await openInvestigationSheet(viewerPage, "Analysis");
      await expect(viewerSheet.getByText(/^Snapshot saved/)).toBeVisible();
      await expect(viewerSheet.getByRole("group", { name: /^Feedback on / })).toHaveCount(0);
      for (const name of ["Run investigation", "Run again", "Save report snapshot"]) {
        await expect(
          viewerSheet.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      }
      await viewerPage.goto("/copilot", { waitUntil: "domcontentloaded" });
      await expect(
        viewerPage.getByText("Read-only access", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

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
      const viewerRestore = await viewerPage.request.post(
        "/api/projects/switch",
        { data: { projectId: viewerOriginalProjectId } },
      );
      expect(viewerRestore.status(), await viewerRestore.text()).toBe(200);
      const remove = await page.request.delete(`/api/projects/${projectId}`);
      expect([200, 404]).toContain(remove.status());
    }
  });
});
