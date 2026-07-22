import { expect } from "@playwright/test";

import { test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";

test.describe("AI SRE diagnostic recipes @aisre @diagnostics @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("rejects an incompatible recipe, then persists and disables a bounded recipe", async ({
    orgOwnerPage: page,
  }) => {
    const projects = await page.request.get("/api/projects");
    expect(projects.status(), await projects.text()).toBe(200);
    const originalProjectId = (
      (await projects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const createdProject = await page.request.post("/api/projects", {
      data: { name: `E2E recipes ${Date.now()}` },
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
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const connectorName = `E2E GitHub diagnostics ${suffix}`;
      const recipeName = `E2E bounded issues ${suffix}`;

      await page.goto("/org-admin?tab=integrations", { waitUntil: "load" });
      await page
        .getByRole("button", { name: "Add connector", exact: true })
        .click();
      const connectorDialog = page.getByRole("dialog", {
        name: "Add connector",
      });
      await connectorDialog.getByLabel("Connector type").click();
      await page.getByRole("option", { name: "GitHub", exact: true }).click();
      await connectorDialog.getByLabel("Name *").fill(connectorName);
      await connectorDialog
        .getByLabel("Endpoint URL")
        .fill("https://api.github.com");
      await connectorDialog
        .getByLabel("Credential value")
        .fill(`e2e_not_a_real_token_${suffix}`);
      await connectorDialog
        .getByRole("button", { name: "Add connector", exact: true })
        .click();
      await expect(connectorDialog).toBeHidden();
      await expect(
        page.getByText(connectorName, { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("columnheader")).toHaveText([
        "Name",
        "Type",
        "Execution",
        "Service scope",
        "Risk",
        "Status",
        "Last validated",
        "",
      ]);
      const connectorRow = page
        .getByRole("row")
        .filter({ hasText: connectorName });
      await expect(connectorRow).not.toContainText("api.github.com");
      await expect(connectorRow).not.toContainText("e2e_not_a_real_token");

      await page.goto("/org-admin?tab=diagnostic-recipes", {
        waitUntil: "load",
      });
      await page
        .getByRole("button", { name: "Add recipe", exact: true })
        .first()
        .click();
      const recipeDialog = page.getByRole("dialog", {
        name: "Add diagnostic recipe",
      });
      const connectorField = recipeDialog
        .getByText("Connector", { exact: true })
        .locator("..");
      await connectorField.getByRole("combobox").click();
      await page
        .getByRole("option", { name: `${connectorName} (github)`, exact: true })
        .click();
      await recipeDialog
        .getByPlaceholder("High latency by route")
        .fill(recipeName);
      const typeField = recipeDialog
        .getByText("Type", { exact: true })
        .locator("..");
      await typeField.getByRole("combobox").click();
      await page.getByRole("option", { name: "promql", exact: true }).click();
      await recipeDialog
        .getByPlaceholder(/sum\(rate\(http_request_duration_seconds_count/)
        .fill("up");
      await recipeDialog
        .getByRole("button", { name: "Save recipe", exact: true })
        .click();
      await expect(
        page.getByText(
          "promql diagnostic queries are not supported for github connectors",
        ),
      ).toBeVisible();
      await expect(recipeDialog).toBeVisible();

      await typeField.getByRole("combobox").click();
      await page.getByRole("option", { name: "http_get", exact: true }).click();
      await recipeDialog
        .getByPlaceholder(/sum\(rate\(http_request_duration_seconds_count/)
        .fill("/repos/{{repository}}/issues?state=open&per_page=5");
      await recipeDialog
        .getByText("Parameter schema JSON", { exact: true })
        .locator("..")
        .getByRole("textbox")
        .fill(
          JSON.stringify({
            repository: {
              type: "string",
              required: true,
              maxLength: 100,
            },
          }),
        );
      await recipeDialog
        .getByText("Allowlist JSON", { exact: true })
        .locator("..")
        .getByRole("textbox")
        .fill(JSON.stringify({ repository: ["openai/openai-node"] }));
      await recipeDialog
        .getByRole("button", { name: "Save recipe", exact: true })
        .click();
      await expect(recipeDialog).toBeHidden();

      const recipesResponse = await page.request.get(
        "/api/sre/diagnostic-recipes",
      );
      expect(recipesResponse.status(), await recipesResponse.text()).toBe(200);
      const recipesBody = (await recipesResponse.json()) as {
        success: boolean;
        queries: Array<{
          id: string;
          name: string;
          queryType: string;
          status: string;
          maxRows: number;
        }>;
      };
      expect(recipesBody.success).toBe(true);
      expect(
        recipesBody.queries.find((recipe) => recipe.name === recipeName),
      ).toMatchObject({
        id: expect.any(String),
        name: recipeName,
        queryType: "http_get",
        status: "active",
        maxRows: 100,
      });

      const row = page.getByRole("row").filter({ hasText: recipeName });
      await expect(page.getByRole("columnheader")).toHaveText([
        "Name",
        "Template",
        "Connector",
        "Connector Type",
        "Type",
        "Limits",
        "Status",
        "",
      ]);
      await expect(row).toContainText("active");
      await row
        .getByRole("button", { name: `Open actions for ${recipeName}` })
        .click();
      await page.getByRole("menuitem", { name: /disable/i }).click();
      const disableDialog = page.getByRole("alertdialog", {
        name: "Disable diagnostic recipe?",
      });
      await disableDialog
        .getByRole("button", { name: "Disable recipe", exact: true })
        .click();
      await expect(row).toContainText("disabled");
      await page.reload();
      await expect(
        page.getByRole("row").filter({ hasText: recipeName }),
      ).toContainText("disabled");
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
