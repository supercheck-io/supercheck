import { expect, type Page } from "@playwright/test";

import { test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";
import { waitForHydration } from "../../utils/hydration";

test.describe("AI SRE service topology administration @aisre @topology @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("creates and removes a project-scoped trusted dependency with map persistence", async ({
    orgOwnerPage: page,
    viewerPage,
  }) => {
    const projectsResponse = await page.request.get("/api/projects");
    expect(projectsResponse.status(), await projectsResponse.text()).toBe(200);
    const originalProjectId = (
      (await projectsResponse.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const viewerProjectsResponse =
      await viewerPage.request.get("/api/projects");
    expect(
      viewerProjectsResponse.status(),
      await viewerProjectsResponse.text(),
    ).toBe(200);
    const viewerOriginalProjectId = (
      (await viewerProjectsResponse.json()) as {
        currentProject: { id: string };
      }
    ).currentProject.id;
    const projectResponse = await page.request.post("/api/projects", {
      data: { name: `E2E topology ${Date.now()}` },
    });
    expect(projectResponse.status(), await projectResponse.text()).toBe(201);
    const projectId = (
      (await projectResponse.json()) as { data: { id: string } }
    ).data.id;

    try {
      // Switch inside the try so a failed selection still cleans up the project.
      const switched = await page.request.post("/api/projects/switch", {
        data: { projectId },
      });
      expect(switched.status(), await switched.text()).toBe(200);

      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sourceName = `E2E checkout ${suffix}`;
      const targetName = `E2E database ${suffix}`;
      const sourceId = await createService(page, sourceName);
      await createService(page, targetName);

      await page.goto(`/services/${sourceId}`, { waitUntil: "load" });
      await waitForHydration(page);
      await page.getByRole("tab", {name:/Dependencies/}).click();
      await page
        .getByRole("button", { name: "Add dependency", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Add dependency" });
      await expect(dialog).toContainText(
        "Choose which service depends on the other.",
      );
      const relatedService = dialog
        .getByText("Related service", { exact: true })
        .locator("..");
      await relatedService.getByRole("combobox").click();
      await expect(
        page.getByRole("option", { name: sourceName, exact: true }),
      ).toHaveCount(0);
      await page.getByRole("option", { name: targetName, exact: true }).click();
      await dialog
        .getByRole("button", { name: "Add dependency", exact: true })
        .click();
      await expect(dialog).toBeHidden();

      const dependency = page
        .getByRole("button", {
          name: `Remove dependency with ${targetName}`,
          exact: true,
        })
        .locator("..")
        .locator("..");
      await expect(dependency).toContainText("This service depends on it");
      await expect(dependency).toContainText("manual");
      await page.reload();
      await waitForHydration(page);
      await page.getByRole("tab", {name:/Dependencies/}).click();
      await expect(page.getByText(targetName, { exact: true })).toBeVisible();

      const viewerSwitch = await viewerPage.request.post(
        "/api/projects/switch",
        { data: { projectId } },
      );
      expect(viewerSwitch.status(), await viewerSwitch.text()).toBe(200);
      await viewerPage.goto(`/services/${sourceId}`, { waitUntil: "load" });
      await waitForHydration(viewerPage);
      await expect(
        viewerPage.getByRole("heading", { name: sourceName, exact: true }),
      ).toBeVisible();
      await viewerPage.getByRole("tab", {name:/Dependencies/}).click();
      await expect(
        viewerPage.getByRole("button", {
          name: "Add dependency",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", {
          name: `Remove dependency with ${targetName}`,
        }),
      ).toHaveCount(0);

      await page.goto(`/services/${sourceId}`, { waitUntil: "load" });
      await waitForHydration(page);
      await page.getByRole("tab", {name:/Dependencies/}).click();
      await page
        .getByRole("button", { name: `Remove dependency with ${targetName}` })
        .click();
      await expect(page.getByText(targetName, { exact: true })).toHaveCount(0);
      await page.reload();
      await waitForHydration(page);
      await page.getByRole("tab", {name:/Dependencies/}).click();
      await expect(page.getByText(targetName, { exact: true })).toHaveCount(0);
    } finally {
      const viewerRestored = await viewerPage.request.post(
        "/api/projects/switch",
        { data: { projectId: viewerOriginalProjectId } },
      );
      expect(viewerRestored.status(), await viewerRestored.text()).toBe(200);
      const restored = await page.request.post("/api/projects/switch", {
        data: { projectId: originalProjectId },
      });
      expect(restored.status(), await restored.text()).toBe(200);
      const removed = await page.request.delete(`/api/projects/${projectId}`);
      expect([200, 404]).toContain(removed.status());
    }
  });
});

async function createService(page: Page, name: string): Promise<string> {
  await page.goto("/services", { waitUntil: "load" });
  await waitForHydration(page);
  await page.getByTestId("add-service-btn").click();
  const dialog = page.getByRole("dialog", { name: "Add service" });
  await dialog.getByLabel("Service name *").fill(name);
  await dialog.getByLabel("Environment").fill("staging");
  await dialog.getByTestId("submit-service-btn").click();
  await expect(dialog).toBeHidden();

  const response = await page.request.get("/api/sre/services");
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {
    services: Array<{ id: string; name: string }>;
  };
  const service = body.services.find((candidate) => candidate.name === name);
  expect(service).toEqual(
    expect.objectContaining({ id: expect.any(String), name }),
  );
  if (!service) throw new Error(`Service ${name} was not persisted`);
  return service.id;
}
