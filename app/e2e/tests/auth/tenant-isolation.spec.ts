import { expect, test } from "@playwright/test";

import { authenticateWithApi } from "../../utils/api-auth";
import { env } from "../../utils/env";

test.describe("Tenant and project isolation @auth @rbac @security", () => {
  test("allows organization-wide viewer reads but prevents cross-project mutation @critical @security", async ({
    playwright,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required");
    for (const [name, credentials] of Object.entries({
      orgOwner: env.rbacUsers.orgOwner,
      viewer: env.rbacUsers.viewer,
    })) {
      if (!credentials.email || !credentials.password) {
        throw new Error(
          `${name} credentials are required for tenant-isolation coverage`,
        );
      }
    }

    const [ownerState, viewerState] = await Promise.all([
      authenticateWithApi(playwright.request, baseURL, env.rbacUsers.orgOwner),
      authenticateWithApi(playwright.request, baseURL, env.rbacUsers.viewer),
    ]);
    const owner = await playwright.request.newContext({
      baseURL,
      storageState: ownerState,
    });
    const viewer = await playwright.request.newContext({
      baseURL,
      storageState: viewerState,
    });
    let projectId: string | undefined;
    let testId: string | undefined;

    try {
      const projectName = `E2E isolated project ${Date.now()}`;
      const createProject = await owner.post("/api/projects", {
        data: { name: projectName },
      });
      expect(createProject.status(), await createProject.text()).toBe(201);
      const project = (await createProject.json()) as {
        data: { id: string; name: string; organizationId: string };
      };
      projectId = project.data.id;
      expect(project.data).toMatchObject({
        id: expect.any(String),
        name: projectName,
        organizationId: expect.any(String),
      });

      const ownerProject = await playwright.request.newContext({
        baseURL,
        storageState: ownerState,
        extraHTTPHeaders: { "x-project-id": projectId },
      });
      try {
        const title = `E2E isolated test ${Date.now()}`;
        const createTest = await ownerProject.post("/api/tests", {
          data: {
            title,
            description: "Tenant-isolation fixture",
            type: "custom",
            priority: "medium",
            script:
              "import { test, expect } from '@playwright/test'; test('isolated', async () => expect(true).toBe(true));",
          },
        });
        expect(createTest.status(), await createTest.text()).toBe(201);
        const created = (await createTest.json()) as {
          id?: string;
          data?: { id: string };
          test?: { id: string };
        };
        testId = created.id ?? created.data?.id ?? created.test?.id;
        expect(testId).toEqual(expect.any(String));

        const viewerHeaders = { "x-project-id": projectId };
        const [list, read, update, remove] = await Promise.all([
          viewer.get("/api/tests", { headers: viewerHeaders }),
          viewer.get(`/api/tests/${testId}`, { headers: viewerHeaders }),
          viewer.put(`/api/tests/${testId}`, {
            headers: viewerHeaders,
            data: { title: "unauthorized mutation" },
          }),
          viewer.delete(`/api/tests/${testId}`, { headers: viewerHeaders }),
        ]);
        expect(list.status()).toBe(200);
        const listed = (await list.json()) as { data: Array<{ id: string }> };
        expect(listed.data).toContainEqual(expect.objectContaining({ id: testId as string }));
        expect(read.status()).toBe(200);
        expect(await read.json()).toMatchObject({ id: testId, title });
        expect(update.status()).toBe(403);
        expect(remove.status()).toBe(403);

        const ownerRead = await ownerProject.get(`/api/tests/${testId}`);
        expect(ownerRead.status(), await ownerRead.text()).toBe(200);
        expect(await ownerRead.json()).toMatchObject({ id: testId, title });
      } finally {
        if (testId) {
          const cleanup = await ownerProject.delete(`/api/tests/${testId}`);
          if (![200, 404].includes(cleanup.status())) {
            throw new Error(
              `Isolated test cleanup failed (${cleanup.status()}): ${await cleanup.text()}`,
            );
          }
        }
        await ownerProject.dispose();
      }
    } finally {
      if (projectId) {
        const cleanup = await owner.delete(`/api/projects/${projectId}`);
        if (![200, 404].includes(cleanup.status())) {
          throw new Error(
            `Isolated project cleanup failed (${cleanup.status()}): ${await cleanup.text()}`,
          );
        }
      }
      await owner.dispose();
      await viewer.dispose();
    }
  });
});
