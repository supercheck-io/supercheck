import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createTest, deleteTest } from '../../utils/test-data';

test.describe('Tests UI lifecycle @tests', () => {
  test('renders, searches, opens, and preserves the exact API-seeded test @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createTest(request, { title: `E2E UI test ${Date.now()}` });
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));

    await page.goto('/tests');
    await expect(page.getByRole('heading', { name: 'Tests', exact: true })).toBeVisible();
    const search = page.getByRole('textbox', { name: 'Filter by all available fields...', exact: true });
    await expect(search).toBeVisible();
    await search.fill(created.title);

    const row = page.getByRole('row').filter({ hasText: created.title });
    await expect(row).toHaveCount(1);
    await row.getByText(created.title, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/playground/${created.id}(?:$|[/?#])`));
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Templates', exact: true })).toBeVisible();

    const persisted = await request.get(`/api/tests/${created.id}`);
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: created.id, title: created.title });
  });

  test('shows the supported creation choices without conditional fallbacks @high @positive', async ({ projectAdminPage: page }) => {
    await page.goto('/tests/create');
    await expect(page).toHaveURL(/\/tests\/create$/);
    await expect(page.getByRole('button', { name: /^Browser Automate browser interactions/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^API Test REST APIs/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Database Query and test database/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Custom Create advanced integration/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Performance Load test with k6/ })).toBeVisible();
  });

  test('cancels deletion of the exact test and leaves it persisted @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createTest(request, { title: `E2E cancel-delete test ${Date.now()}` });
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));
    await page.goto('/tests');
    const row = page.getByRole('row').filter({ hasText: created.title });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    const persisted = await request.get(`/api/tests/${created.id}`);
    expect(persisted.status()).toBe(200);
  });
});
