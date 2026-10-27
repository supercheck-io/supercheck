import { expect } from "@playwright/test";

import { test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";

test.describe("AI SRE saved queries @aisre @diagnostics @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("rejects an incompatible query, then persists and disables a bounded query", async ({
    orgOwnerPage: page,
  }) => {
    const projects = await page.request.get("/api/projects");
    expect(projects.status(), await projects.text()).toBe(200);
    const originalProjectId = (
      (await projects.json()) as { currentProject: { id: string } }
    ).currentProject.id;
    const createdProject = await page.request.post("/api/projects", {
      data: { name: `E2E saved queries ${Date.now()}` },
    });
    expect(createdProject.status(), await createdProject.text()).toBe(201);
    const projectId = (
      (await createdProject.json()) as { data: { id: string } }
    ).data.id;

    try {
      // Switch inside the try so a failed selection still cleans up the project.
      const switched = await page.request.post("/api/projects/switch", {
        data: { projectId },
      });
      expect(switched.status(), await switched.text()).toBe(200);

      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const connectorName = `E2E GitHub diagnostics ${suffix}`;
      const queryName = `E2E bounded issues ${suffix}`;

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
        "Connector ID",
        "Name",
        "Type",
        "Execution",
        "Private Agent",
        "Status",
        "Last validated",
        "",
      ]);
      const connectorRow = page
        .getByRole("row")
        .filter({ hasText: connectorName });
      await expect(connectorRow).not.toContainText("api.github.com");
      await expect(connectorRow).not.toContainText("e2e_not_a_real_token");

      await page.goto("/org-admin?tab=integrations&section=saved-queries", {
        waitUntil: "load",
      });
      await page
        .getByRole("button", { name: "Add query", exact: true })
        .first()
        .click();
      const queryDialog = page.getByRole("dialog", {
        name: "Add saved query",
      });
      const connectorField = queryDialog
        .getByText("Connector", { exact: true })
        .locator("..");
      await connectorField.getByRole("combobox").click();
      await page
        .getByRole("option", { name: `${connectorName} (github)`, exact: true })
        .click();
      await queryDialog
        .getByPlaceholder("High latency by route")
        .fill(queryName);
      const typeField = queryDialog
        .getByText("Type", { exact: true })
        .locator("..");
      await typeField.getByRole("combobox").click();
      await page.getByRole("option", { name: "promql", exact: true }).click();
      await queryDialog
        .getByPlaceholder(/sum\(rate\(http_request_duration_seconds_count/)
        .fill("up");
      await queryDialog
        .getByRole("button", { name: "Save query", exact: true })
        .click();
      await expect(
        page.getByText(
          "promql diagnostic queries are not supported for github connectors",
        ),
      ).toBeVisible();
      await expect(queryDialog).toBeVisible();

      await typeField.getByRole("combobox").click();
      await page.getByRole("option", { name: "http_get", exact: true }).click();
      await queryDialog
        .getByPlaceholder(/sum\(rate\(http_request_duration_seconds_count/)
        .fill("/repos/{{repository}}/issues?state=open&per_page=5");
      await queryDialog
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
      await queryDialog
        .getByText("Allowlist JSON", { exact: true })
        .locator("..")
        .getByRole("textbox")
        .fill(JSON.stringify({ repository: ["openai/openai-node"] }));
      await queryDialog
        .getByRole("button", { name: "Save query", exact: true })
        .click();
      await expect(queryDialog).toBeHidden();

      const queriesResponse = await page.request.get(
        "/api/sre/diagnostic-recipes",
      );
      expect(queriesResponse.status(), await queriesResponse.text()).toBe(200);
      const queriesBody = (await queriesResponse.json()) as {
        success: boolean;
        queries: Array<{
          id: string;
          name: string;
          queryType: string;
          status: string;
          maxRows: number;
        }>;
      };
      expect(queriesBody.success).toBe(true);
      expect(
        queriesBody.queries.find((query) => query.name === queryName),
      ).toMatchObject({
        id: expect.any(String),
        name: queryName,
        queryType: "http_get",
        status: "active",
        maxRows: 100,
      });

      // Connectors and saved queries now share the Integrations tab, so scope
      // the header contract to the saved-query table.
      const savedQueryTable = page.getByRole("table").filter({
        has: page.getByRole("columnheader", { name: "Limits" }),
      });
      const row = page.getByRole("row").filter({ hasText: queryName });
      await expect(savedQueryTable.getByRole("columnheader")).toHaveText([
        "Query ID",
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
        .getByRole("button", { name: `Open actions for ${queryName}` })
        .click();
      await page.getByRole("menuitem", { name: /disable/i }).click();
      const disableDialog = page.getByRole("alertdialog", {
        name: "Disable saved query?",
      });
      await disableDialog
        .getByRole("button", { name: "Disable query", exact: true })
        .click();
      await expect(row).toContainText("disabled");
      await page.reload();
      await expect(
        page.getByRole("row").filter({ hasText: queryName }),
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
