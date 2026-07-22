import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { createTest, deleteTest } from '../../utils/test-data';

type ExecutionStart = {
  runId: string;
  status: 'queued' | 'running';
  position?: number;
  testType: string;
  location?: string;
};

async function deleteRun(
  request: import('@playwright/test').APIRequestContext,
  runId: string,
): Promise<void> {
  const response = await request.delete(`/api/runs/${runId}`);
  expect([200, 404]).toContain(response.status());
}

test.describe('Advanced execution contracts @execution', () => {
  test('saved Playwright execution can be cancelled and inspected through API and UI @critical @positive', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const page = projectAdminPage;
    const created = await createTest(request, {
      title: `E2E cancellable Playwright ${Date.now()}`,
      type: 'browser',
      script: Buffer.from(
        "import { test, expect } from '@playwright/test'; test('wait', async ({ page }) => { await page.waitForTimeout(30000); expect(true).toBe(true); });",
      ).toString('base64'),
    });
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));

    const executeResponse = await request.post(`/api/tests/${created.id}/execute`, { data: {} });
    expect(executeResponse.status()).toBe(200);
    const execution = (await executeResponse.json()) as ExecutionStart;
    expect(execution).toMatchObject({
      runId: expect.any(String),
      status: expect.stringMatching(/^(queued|running)$/),
    });
    cleanup.add(`run ${execution.runId}`, () => deleteRun(request, execution.runId));

    const activeResponse = await request.get('/api/executions/running');
    expect(activeResponse.status()).toBe(200);
    const active = (await activeResponse.json()) as {
      running: Array<{ runId: string }>;
      queued: Array<{ runId: string; queuePosition?: number }>;
      runningCapacity: number;
      queuedCapacity: number;
    };
    expect(active.runningCapacity).toEqual(expect.any(Number));
    expect(active.queuedCapacity).toEqual(expect.any(Number));
    expect([...active.running, ...active.queued]).toContainEqual(
      expect.objectContaining({ runId: execution.runId }),
    );

    const cancelResponse = await request.post(`/api/runs/${execution.runId}/cancel`);
    expect(cancelResponse.status()).toBe(200);
    expect(await cancelResponse.json()).toMatchObject({
      success: true,
      runId: execution.runId,
      message: 'Run cancelled successfully',
    });

    const detailResponse = await request.get(`/api/runs/${execution.runId}`);
    expect(detailResponse.status()).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      id: execution.runId,
      status: 'error',
      errorDetails: 'Cancellation requested by user',
      trigger: 'manual',
      projectId: expect.any(String),
    });

    const statusResponse = await request.get(`/api/runs/${execution.runId}/status`);
    expect(statusResponse.status()).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      runId: execution.runId,
      status: 'error',
      errorDetails: 'Cancellation requested by user',
    });

    await page.goto(`/runs/${execution.runId}`, { waitUntil: 'load' });
    await expect(page).toHaveURL(new RegExp(`/runs/${execution.runId}$`));
    await expect(page.getByText('Status', { exact: true })).toBeVisible();
    await expect(page.getByText('Error', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i })).toBeEnabled();
  });

  test('k6 execution uses an available location and exposes location metadata @high @positive', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const request = projectAdminPage.request;
    const projectsResponse = await request.get('/api/projects');
    expect(projectsResponse.status()).toBe(200);
    const projects = (await projectsResponse.json()) as {
      currentProject?: { id?: string } | null;
      data?: Array<{ id: string }>;
    };
    const projectId = projects.currentProject?.id ?? projects.data?.[0]?.id;
    expect(projectId).toEqual(expect.any(String));

    const locationsResponse = await request.get('/api/locations/available', {
      params: { projectId: projectId as string },
    });
    expect(locationsResponse.status()).toBe(200);
    const locationsBody = (await locationsResponse.json()) as {
      success: boolean;
      data: { locations: Array<{ code: string; name: string; isEnabled: boolean; online: boolean }> };
    };
    expect(locationsBody.success).toBe(true);
    expect(locationsBody.data.locations.length).toBeGreaterThan(0);
    for (const location of locationsBody.data.locations) {
      expect(location).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          name: expect.any(String),
          isEnabled: true,
          online: expect.any(Boolean),
        }),
      );
    }
    const location = locationsBody.data.locations[0].code;

    const script = `import http from 'k6/http';\nexport const options = { vus: 1, iterations: 1 };\nexport default function () { http.get('https://httpbin.org/status/200'); }`;
    const created = await createTest(request, {
      title: `E2E k6 location ${Date.now()}`,
      type: 'performance',
      script: Buffer.from(script).toString('base64'),
    });
    cleanup.add(`k6 test ${created.id}`, () => deleteTest(request, created.id));

    const executeResponse = await request.post(`/api/tests/${created.id}/execute`, {
      data: { location },
    });
    expect(executeResponse.status()).toBe(200);
    const execution = (await executeResponse.json()) as ExecutionStart;
    expect(execution).toMatchObject({
      runId: expect.any(String),
      status: expect.stringMatching(/^(queued|running)$/),
      testType: 'performance',
      location,
    });
    cleanup.add(`k6 run ${execution.runId}`, () => deleteRun(request, execution.runId));

    const cancelResponse = await request.post(`/api/runs/${execution.runId}/cancel`);
    expect(cancelResponse.status()).toBe(200);
    const detailResponse = await request.get(`/api/runs/${execution.runId}`);
    expect(detailResponse.status()).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      id: execution.runId,
      status: 'error',
    });
  });

  test('execution and location endpoints enforce authentication and project isolation @high @security', async ({
    request,
    playwright,
  }) => {
    const crossProject = await request.get('/api/locations/available', {
      params: { projectId: '00000000-0000-4000-8000-000000000001' },
    });
    expect(crossProject.status()).toBe(403);
    expect(await crossProject.json()).toEqual({ success: false, error: 'Access denied' });

    const unauthenticated = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const endpoint of ['/api/executions/running', '/api/locations/available']) {
        const response = await unauthenticated.get(endpoint);
        expect(response.status()).toBe(401);
        expect(await response.json()).toMatchObject({ error: expect.any(String) });
      }
      const cancel = await unauthenticated.post(
        '/api/runs/00000000-0000-4000-8000-000000000001/cancel',
      );
      expect(cancel.status()).toBe(401);
      expect(await cancel.json()).toMatchObject({ error: expect.any(String) });
    } finally {
      await unauthenticated.dispose();
    }
  });
});
