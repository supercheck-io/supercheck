import { expect } from "@playwright/test";

import { test } from "../../fixtures";
import {
  createJob,
  createMonitor,
  createTest,
  deleteJob,
  deleteMonitor,
  deleteTest,
} from "../../utils/test-data";

test.describe("Core resource API lifecycle @api @critical", () => {
  test("creates, reads, filters, and deletes a Playwright test", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const created = await createTest(request);
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));

    const list = await request.get("/api/tests", {
      params: { search: created.title, includeScript: "true" },
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data: Array<{ id: string; title: string; script?: string }>;
      pagination: { total: number };
    };
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: created.id,
        title: created.title,
        script: expect.any(String),
      }),
    );
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  test("creates and reads a project-scoped HTTP monitor", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const created = await createMonitor(request);
    cleanup.add(`monitor ${created.id}`, () =>
      deleteMonitor(request, created.id),
    );

    const list = await request.get("/api/monitors", {
      params: { page: "1", limit: "100" },
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data?: Array<{ id: string; name: string }>;
      monitors?: Array<{ id: string; name: string }>;
    };
    const monitors = body.data ?? body.monitors;
    expect(monitors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, name: created.name }),
      ]),
    );
  });

  test("reads project-scoped status pages with pagination metadata", async ({
    request,
  }) => {
    const list = await request.get("/api/status-pages", {
      params: { page: "1", limit: "100" },
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data: unknown[];
      pagination: { page: number; limit: number; total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 100,
        total: expect.any(Number),
      }),
    );
  });

  test("reads project-scoped requirements with coverage metadata", async ({
    request,
  }) => {
    const list = await request.get("/api/requirements", {
      params: { page: "1", pageSize: "100" },
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data: Array<{ id: string; title: string; coverageStatus: string }>;
      total: number;
      page: number;
      pageSize: number;
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        page: 1,
        pageSize: 100,
      }),
    );
    for (const requirement of body.data) {
      expect(requirement).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          coverageStatus: expect.any(String),
        }),
      );
    }
  });

  test("creates a job with an isolated test and reads both resources", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const created = await createJob(request);
    cleanup.add(`created test ${created.createdTestId}`, async () => {
      if (created.createdTestId)
        await deleteTest(request, created.createdTestId);
    });
    cleanup.add(`job ${created.id}`, () => deleteJob(request, created.id));

    const list = await request.get("/api/jobs");
    expect(list.status()).toBe(200);
    const body = (await list.json()) as {
      data?: Array<{ id: string; name: string }>;
      jobs?: Array<{ id: string; name: string }>;
    };
    const jobs = body.data ?? body.jobs;
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, name: created.name }),
      ]),
    );
  });

  test("creates, updates, associates, protects, detaches, and deletes a project tag", async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const suffix =
      `${Date.now()}${Math.random().toString(36).slice(2, 6)}`.slice(-12);
    const createTag = await request.post("/api/tags", {
      data: { name: `e2e-${suffix}`, color: "#2563EB" },
    });
    expect(createTag.status(), await createTag.text()).toBe(201);
    const tag = (await createTag.json()) as {
      id: string;
      name: string;
      color: string;
    };
    expect(tag).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      name: `e2e-${suffix}`,
      color: "#2563EB",
    });
    cleanup.add(`tag ${tag.id}`, async () => {
      const response = await request.delete(`/api/tags/${tag.id}`);
      if (![200, 404].includes(response.status())) {
        throw new Error(
          `Tag cleanup failed (${response.status()}): ${await response.text()}`,
        );
      }
    });

    const createdTest = await createTest(request, {
      title: `E2E tagged test ${suffix}`,
    });
    cleanup.add(`test ${createdTest.id}`, () =>
      deleteTest(request, createdTest.id),
    );
    const attach = await request.post(`/api/tests/${createdTest.id}/tags`, {
      data: { tagIds: [tag.id] },
    });
    expect(attach.status(), await attach.text()).toBe(200);
    expect(await attach.json()).toEqual([
      expect.objectContaining({ id: tag.id, name: tag.name, color: tag.color }),
    ]);

    const duplicate = await request.post(`/api/tests/${createdTest.id}/tags`, {
      data: { tagIds: [tag.id, tag.id] },
    });
    expect(duplicate.status(), await duplicate.text()).toBe(400);
    expect(await duplicate.json()).toEqual({
      error: "Duplicate tag IDs are not allowed",
    });

    const protectedDelete = await request.delete(`/api/tags/${tag.id}`);
    expect(protectedDelete.status(), await protectedDelete.text()).toBe(409);
    expect(await protectedDelete.json()).toMatchObject({
      usageCount: 1,
      testCount: 1,
      requirementCount: 0,
      tagName: tag.name,
    });

    const detach = await request.delete(`/api/tests/${createdTest.id}/tags`, {
      data: { tagId: tag.id },
    });
    expect(detach.status(), await detach.text()).toBe(200);
    expect(await detach.json()).toEqual({ success: true });
    const associated = await request.get(`/api/tests/${createdTest.id}/tags`);
    expect(associated.status(), await associated.text()).toBe(200);
    expect(await associated.json()).toEqual([]);

    const updatedName = `upd-${suffix}`;
    const update = await request.put(`/api/tags/${tag.id}`, {
      data: { name: updatedName, color: "#16A34A" },
    });
    expect(update.status(), await update.text()).toBe(200);
    expect(await update.json()).toMatchObject({
      id: tag.id,
      name: updatedName,
      color: "#16A34A",
    });

    const remove = await request.delete(`/api/tags/${tag.id}`);
    expect(remove.status(), await remove.text()).toBe(200);
    expect(await remove.json()).toMatchObject({
      message: "Tag deleted successfully",
      deletedTag: { id: tag.id, name: updatedName },
    });
    const missing = await request.get(`/api/tags/${tag.id}`);
    expect(missing.status(), await missing.text()).toBe(404);
  });
});

test.describe("Core resource unauthenticated boundaries @api @security @critical", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const endpoint of [
    "/api/tests",
    "/api/jobs",
    "/api/monitors",
    "/api/status-pages",
    "/api/requirements",
    "/api/tags",
  ]) {
    test(`${endpoint} rejects unauthenticated reads`, async ({ request }) => {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({
        error: expect.any(String),
      });
    });
  }
});
