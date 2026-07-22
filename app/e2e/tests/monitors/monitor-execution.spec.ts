import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { MonitorCreatePage } from '../../pages/monitors.page';
import { createMonitor, deleteMonitor } from '../../utils/test-data';

test.describe('Monitor lifecycle @monitors @execution', () => {
  test('shows an isolated HTTP monitor in the UI and opens its detail @critical @positive', async ({
    projectAdminPage,
    cleanup,
  }) => {
    const page = projectAdminPage;
    const request = projectAdminPage.request;
    const created = await createMonitor(request);
    cleanup.add(`monitor ${created.id}`, () => deleteMonitor(request, created.id));

    await page.goto('/monitors', { waitUntil: 'load' });
    await page.getByTestId('search-input').fill(created.name);
    const row = page.getByRole('row').filter({ hasText: created.name });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page).toHaveURL(new RegExp(`/monitors/${created.id}`));
    await expect(page.getByRole('heading', { name: created.name })).toBeVisible();

    const response = await request.get(`/api/monitors/${created.id}`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        id: created.id,
        name: created.name,
      }),
    );
  });

  test('monitor creation UI exposes HTTP and synthetic types @high @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/monitors/create');

    const createPage = new MonitorCreatePage(page);
    await createPage.expectLoaded();
    await expect(page.getByRole('link', { name: /^HTTP Monitor / })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Synthetic Monitor / })).toBeVisible();
  });
});
