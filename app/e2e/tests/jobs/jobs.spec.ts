import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createJob, deleteJob, deleteTest } from '../../utils/test-data';

test.describe('Jobs UI lifecycle @jobs', () => {
  test('renders and opens the exact API-seeded job @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createJob(request, { name: `E2E UI job ${Date.now()}` });
    cleanup.add(`test ${created.createdTestId}`, async () => {
      if (created.createdTestId) await deleteTest(request, created.createdTestId);
    });
    cleanup.add(`job ${created.id}`, () => deleteJob(request, created.id));

    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toHaveCount(1);
    await row.getByText(created.name, { exact: true }).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(created.name, { exact: true })).toBeVisible();

    const persisted = await request.get(`/api/jobs/${created.id}`);
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: created.id, name: created.name });
  });

  test('shows both supported job creation choices @high @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/jobs/create');
    await expect(page).toHaveURL(/\/jobs\/create$/);
    await expect(page.getByRole('button', { name: /^Playwright Job / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^k6 Performance Job / })).toBeVisible();
  });

  test('cancels deletion of the exact job and leaves it persisted @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createJob(request, { name: `E2E cancel-delete job ${Date.now()}` });
    cleanup.add(`test ${created.createdTestId}`, async () => {
      if (created.createdTestId) await deleteTest(request, created.createdTestId);
    });
    cleanup.add(`job ${created.id}`, () => deleteJob(request, created.id));
    await page.goto('/jobs');
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    const persisted = await request.get(`/api/jobs/${created.id}`);
    expect(persisted.status()).toBe(200);
  });
});
