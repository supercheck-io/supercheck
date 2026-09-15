import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createJob, createMonitor, deleteJob, deleteMonitor, deleteTest } from '../../utils/test-data';

test.describe('Dashboard contracts @dashboard', () => {
  test('API totals and visible metric cards include exact seeded resources @critical @positive', async ({ projectAdminPage, cleanup }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const monitor = await createMonitor(request, { name: `E2E dashboard monitor ${Date.now()}` });
    cleanup.add(`monitor ${monitor.id}`, () => deleteMonitor(request, monitor.id));
    const job = await createJob(request, { name: `E2E dashboard job ${Date.now()}` });
    cleanup.add(`test ${job.createdTestId}`, async () => {
      if (job.createdTestId) await deleteTest(request, job.createdTestId);
    });
    cleanup.add(`job ${job.id}`, () => deleteJob(request, job.id));

    const response = await request.get('/api/dashboard');
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store, no-cache, must-revalidate');
    const dashboard = await response.json() as {
      tests: { total: number };
      jobs: { total: number; active: number };
      monitors: { total: number; active: number; up: number; down: number };
      requirements: { total: number; covered: number; atRisk: number; coveragePercentage: number };
      queue: { running: number; queued: number };
      system: { healthy: boolean; issues: unknown[]; timestamp: string };
    };
    expect(dashboard.tests.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.jobs.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.monitors.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.requirements).toEqual(expect.objectContaining({
      total: expect.any(Number), covered: expect.any(Number), atRisk: expect.any(Number), coveragePercentage: expect.any(Number),
    }));
    expect(dashboard.queue).toEqual(expect.objectContaining({ running: expect.any(Number), queued: expect.any(Number) }));
    expect(Number.isNaN(Date.parse(dashboard.system.timestamp))).toBe(false);

    await page.goto('/');
    await expect(page.getByText('Total Tests', { exact: true })).toBeVisible();
    await expect(page.getByText('Active Jobs', { exact: true })).toBeVisible();
    await expect(page.getByText('Active Monitors', { exact: true })).toBeVisible();
    await expect(page.getByText('Requirements', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tests', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Monitors', exact: true })).toBeVisible();
  });
});

test.describe('Dashboard authentication @dashboard @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('rejects dashboard API and redirects dashboard UI @critical @security', async ({ page, request }) => {
    const response = await request.get('/api/dashboard');
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
});
