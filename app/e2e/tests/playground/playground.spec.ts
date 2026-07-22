import { expect } from '@playwright/test';

import { test } from '../../fixtures';
import { createTest, deleteTest } from '../../utils/test-data';

test.describe('Playground UI @playground', () => {
  test('loads the exact saved test into Monaco with executable controls @critical @positive', async ({ projectAdminPage: page, cleanup }) => {
    test.setTimeout(90_000);
    const request = page.request;
    const created = await createTest(request, { title: `E2E Playground ${Date.now()}` });
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));
    await page.goto(`/playground/${created.id}`);
    await expect(page).toHaveURL(new RegExp(`/playground/${created.id}$`));
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Templates', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /AI Create/i })).toBeVisible();
  });

  test('opens the templates workflow and closes it without mutating the saved test @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createTest(request, { title: `E2E Templates ${Date.now()}` });
    cleanup.add(`test ${created.id}`, () => deleteTest(request, created.id));
    await page.goto(`/playground/${created.id}`);
    const templates = page.getByRole('button', { name: 'Templates', exact: true });
    await expect(templates).toBeVisible({ timeout: 30_000 });
    await templates.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/template/i);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const persisted = await request.get(`/api/tests/${created.id}`, { params: { includeScript: 'true' } });
    expect(persisted.status(), await persisted.text()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: created.id, title: created.title });
  });
});

test.describe('Playground authentication @playground @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('redirects an unauthenticated saved-test route to sign-in @critical @security', async ({ page }) => {
    await page.goto('/playground/01900000-0000-7000-8000-000000000000');
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
});
