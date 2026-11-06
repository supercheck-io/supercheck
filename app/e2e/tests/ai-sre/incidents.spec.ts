import { expect, test } from "../../fixtures/roles.fixture";

import { requireRbacUser } from "../../utils/env";

import type { Page } from "@playwright/test";

// The root hydration flag can fire before nested Suspense boundaries hydrate, so
// a first click on a fresh page may be dropped: retry until the tab is shown.
async function openInvestigationTab(page: Page) {
  const panel = page.getByRole("tabpanel", { name: "Investigation", exact: true });
  const trigger = page.getByRole("tab", { name: "Investigation", exact: true });
  await expect(async () => {
    if (!(await panel.isVisible())) await trigger.click();
    await expect(panel).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  return panel;
}

test.describe("AI SRE incident, brief, and investigation lifecycle @aisre @critical", () => {
  test.beforeAll(() => {
    requireRbacUser("orgOwner");
    requireRbacUser("viewer");
  });

  test("persists a manual incident, bounded brief, investigation, and legacy redirect", async ({
    orgOwnerPage: page,
    viewerPage,
  }) => {
    // Bounded AI operations (brief, investigation) plus the incident and cleanup lifecycle.
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

    try {
      // Switch inside the try so a failed selection still cleans up the project.
      const switchProject = await page.request.post("/api/projects/switch", {
        data: { projectId },
      });
      expect(switchProject.status(), await switchProject.text()).toBe(200);

      // No alert-promoted incident here: an incident nobody owns emails the project admins.
      const incidentTitle = `E2E SRE incident ${Date.now()}`;
      const initialNotes = "No root cause is asserted without cited evidence.";
      await page.goto("/incidents");
      await expect(
        page.getByRole("heading", { name: "Incidents", exact: true }),
      ).toBeVisible();
      // Severity and Status headers carry info-tip text, so match prefixes in exact order.
      await expect(page.getByRole("columnheader")).toHaveText([
        /^#/, /^Title/, /^Severity/, /^Status/, /^Service/, /^Assignee/, /^Age/, /^Updated/, /^AI/,
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
      const sheet = await openInvestigationTab(page);
      // One report; live-source options sit behind the Run options control.
      await expect(page).toHaveURL(/[?&]tab=investigation/);
      await expect(sheet.getByRole("heading", { name: "Conclusion" })).toBeVisible();
      await sheet.getByRole("button", { name: "Run options", exact: true }).click();
      await expect(page.getByLabel("Include live sources")).toBeDisabled();
      await expect(
        page.getByText("Link a service to use live sources.", { exact: false }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await sheet
        .getByRole("button", { name: "Generate brief", exact: true })
        .click();
      // A brief is a quick summary, not a rated investigation.
      await expect(
        sheet.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible({ timeout: 90_000 });
      await expect(sheet.getByText(/^Confidence:/)).toHaveCount(0);

      await page.reload();
      const reloadedSheet = await openInvestigationTab(page);
      await expect(
        reloadedSheet.getByRole("button", { name: "Regenerate brief", exact: true }),
      ).toBeVisible();

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
      // The run may finish asynchronously (202); the snapshot action only
      // appears in the overflow menu once the run has completed.
      await reloadedSheet
        .getByRole("button", { name: "More investigation actions", exact: true })
        .click({ timeout: 120_000 });
      await page.getByRole("menuitem", { name: "Save report snapshot", exact: true }).click();
      await expect(reloadedSheet.getByText(/Snapshot saved/)).toBeVisible();
      await page.keyboard.press("Escape");

      // Feedback lives on the Overview tab's summary card as Right/Wrong plus a note.
      await page.getByRole("tab", { name: "Overview", exact: true }).click();
      await expect(page).not.toHaveURL(/[?&]tab=/);
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
      // Overview carries no ?tab=, so the reload lands on the summary card.
      const persistedRight = page
        .getByTestId("incident-ai-summary")
        .getByRole("button", { name: "Right: this investigation" });
      await expect(persistedRight).toHaveAttribute("aria-pressed", "true");
      // The saved note is shown in the verdict tooltip.
      await persistedRight.hover();
      await expect(page.getByRole("tooltip")).toContainText(`You marked this right: ${note}`);
      const persistedSheet = await openInvestigationTab(page);
      await expect(persistedSheet.getByText(/Snapshot saved/)).toBeVisible();

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
      const viewerSheet = await openInvestigationTab(viewerPage);
      await expect(viewerSheet.getByText(/Snapshot saved/)).toBeVisible();
      await expect(viewerSheet.getByRole("group", { name: /^Feedback on / })).toHaveCount(0);
      for (const name of ["Run investigation", "Run again", "Run options", "More investigation actions"]) {
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
