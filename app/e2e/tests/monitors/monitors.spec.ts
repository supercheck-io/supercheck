import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createMonitor, deleteMonitor } from '../../utils/test-data';

test.describe('Monitors UI lifecycle @monitors', () => {
  test('renders and opens the exact API-seeded monitor @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createMonitor(request, { name: `E2E UI monitor ${Date.now()}` });
    cleanup.add(`monitor ${created.id}`, () => deleteMonitor(request, created.id));

    await page.goto('/monitors');
    await expect(page.getByRole('heading', { name: 'Monitors', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toHaveCount(1);
    await page.goto(`/monitors/${created.id}`);
    await expect(page).toHaveURL(new RegExp(`/monitors/${created.id}(?:$|[/?#])`));
    await expect(page.getByRole('heading', { name: created.name, exact: true })).toBeVisible();

    const persisted = await request.get(`/api/monitors/${created.id}`);
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: created.id, name: created.name });
  });

  test('shows every implemented monitor creation choice @high @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/monitors/create');
    await expect(page).toHaveURL(/\/monitors\/create$/);
    for (const monitorType of ['HTTP Monitor', 'Website Monitor', 'Ping Monitor', 'Port Monitor', 'Synthetic Monitor']) {
      await expect(page.getByRole('heading', { name: monitorType, exact: true })).toBeVisible();
    }
  });

  test('cancels deletion of the exact monitor and leaves it persisted @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createMonitor(request, { name: `E2E cancel-delete monitor ${Date.now()}` });
    cleanup.add(`monitor ${created.id}`, () => deleteMonitor(request, created.id));
    await page.goto('/monitors');
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    const persisted = await request.get(`/api/monitors/${created.id}`);
    expect(persisted.status()).toBe(200);
  });
});
