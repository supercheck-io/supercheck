import { test, expect } from "../../fixtures";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  isDefault: boolean;
};

test.describe("Organization project administration @admin @projects @critical", () => {
  test("org owner creates, renders, edits, persists, and deletes an isolated project", async ({
    orgOwnerPage,
    cleanup,
  }) => {
    const request = orgOwnerPage.request;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = `E2E project ${suffix}`.slice(0, 20);
    const updatedName = `E2E updated ${suffix}`.slice(0, 20);
    let deleted = false;

    const createResponse = await request.post("/api/projects", {
      data: { name, description: "E2E isolated project" },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const created = (await createResponse.json()) as {
      success: boolean;
      data: Project;
    };
    expect(created).toMatchObject({
      success: true,
      data: {
        name,
        description: "E2E isolated project",
        status: "active",
        isDefault: false,
      },
    });
    cleanup.add(`project ${created.data.id}`, async () => {
      if (deleted) return;
      const response = await request.delete(`/api/projects/${created.data.id}`);
      if (!response.ok() && response.status() !== 404) {
        throw new Error(`Project cleanup failed: ${await response.text()}`);
      }
    });

    await orgOwnerPage.goto("/org-admin", { waitUntil: "domcontentloaded" });
    await expect(
      orgOwnerPage.getByRole("heading", { name: "Organization Admin" }),
    ).toBeVisible();
    const row = orgOwnerPage.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("E2E isolated project");
    await expect(row).toContainText("active");

    await row.getByRole("button").last().click();
    const dialog = orgOwnerPage.getByRole("dialog", { name: "Edit Project" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill(updatedName);
    await dialog.getByLabel("Description").fill("Persisted through the UI");
    await dialog.getByRole("button", { name: "Update Project" }).click();
    await expect(dialog).toBeHidden();

    const readResponse = await request.get(`/api/projects/${created.data.id}`);
    expect(readResponse.status(), await readResponse.text()).toBe(200);
    expect(await readResponse.json()).toMatchObject({
      success: true,
      project: {
        id: created.data.id,
        name: updatedName,
        description: "Persisted through the UI",
        status: "active",
      },
    });

    const deleteResponse = await request.delete(
      `/api/projects/${created.data.id}`,
    );
    expect(deleteResponse.status(), await deleteResponse.text()).toBe(200);
    expect(await deleteResponse.json()).toEqual({
      success: true,
      message: "Project deleted successfully",
    });
    deleted = true;

    const deletedResponse = await request.get(
      `/api/projects/${created.data.id}`,
    );
    expect(deletedResponse.status(), await deletedResponse.text()).toBe(200);
    expect(await deletedResponse.json()).toMatchObject({
      project: { id: created.data.id, status: "deleted" },
    });
  });

  test("viewer cannot create or mutate projects and unauthenticated callers are rejected", async ({
    viewerPage,
    playwright,
    baseURL,
  }) => {
    const createResponse = await viewerPage.request.post("/api/projects", {
      data: {
        name: `Forbidden ${Date.now()}`,
        description: "must not persist",
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(403);

    await viewerPage.goto("/org-admin", { waitUntil: "domcontentloaded" });
    await expect(
      viewerPage.getByRole("button", { name: "Create Project" }),
    ).toHaveCount(0);

    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const method of ["get", "post"] as const) {
        const response = await anonymous[method]("/api/projects", {
          data: method === "post" ? { name: "anonymous" } : undefined,
        });
        expect(response.status(), await response.text()).toBe(401);
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
