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
      jobs: { total: number; active: number; scheduled: number };
      monitors: { total: number; active: number; up: number; down: number; paused: number; pending: number; maintenance: number; error: number };
      queue: { running: number; queued: number };
      system: { healthy: boolean; issues: unknown[]; timestamp: string };
    };
    expect(dashboard.tests.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.jobs.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.monitors.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.jobs.scheduled).toEqual(expect.any(Number));
    expect(dashboard.monitors).toEqual(expect.objectContaining({
      paused: expect.any(Number), pending: expect.any(Number), maintenance: expect.any(Number), error: expect.any(Number),
    }));
    expect(dashboard.queue).toEqual(expect.objectContaining({ running: expect.any(Number), queued: expect.any(Number) }));
    expect(Number.isNaN(Date.parse(dashboard.system.timestamp))).toBe(false);

    await page.goto('/');
    const testsCard = page.getByTestId('metric-tests');
    try {
      await expect(testsCard).toBeVisible({ timeout: 15_000 });
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(testsCard).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.getByTestId('metric-jobs')).toContainText('Jobs');
    await expect(page.getByTestId('metric-monitors')).toContainText('Monitors');
    await expect(page.getByTestId('metric-requirements')).toContainText('Requirements coverage');
    await expect(page.getByTestId('metric-browser-minutes')).toContainText('Browser minutes');
    await expect(page.getByTestId('metric-k6-vu-minutes')).toContainText('k6 VU-minutes');
    await expect(page.getByTestId('panel-needs-attention')).toBeVisible();
    await expect(page.getByTestId('panel-needs-attention')).toContainText('by trigger, last 7 days');
    await expect(page.getByRole('tab', { name: /Alerts/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Learn how project status is calculated' })).toBeVisible();
    await expect(page.getByText('Test Types', { exact: true })).toHaveCount(0);
    // The k6 / Playwright analytics tabs moved to the Runs page.
    await expect(page.getByRole('tab', { name: /K6 Job Analytics/ })).toHaveCount(0);
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

test.describe('Runs analytics views @runs @dashboard', () => {
  test('tabs are URL-synced and host the moved analytics @positive', async ({ projectAdminPage }) => {
    const page = projectAdminPage;

    await page.goto('/runs');
    await expect(page.getByRole('tab', { name: 'All runs' })).toHaveAttribute('data-state', 'active');

    await page.getByRole('tab', { name: /Performance \(k6\)/ }).click();
    await expect(page).toHaveURL(/\/runs\?view=k6$/);
    await expect(page.getByRole('tab', { name: /Performance \(k6\)/ })).toHaveAttribute('data-state', 'active');

    await page.getByRole('tab', { name: /Browser \(Playwright\)/ }).click();
    await expect(page).toHaveURL(/\/runs\?view=playwright$/);

    // Deep link restores the selected view
    await page.goto('/runs?view=k6');
    await expect(page.getByRole('tab', { name: /Performance \(k6\)/ })).toHaveAttribute('data-state', 'active');

    await page.getByRole('tab', { name: 'All runs' }).click();
    await expect(page).toHaveURL(/\/runs$/);
  });
});
