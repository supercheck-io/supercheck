import { expect, test } from '@playwright/test';

test.describe('Cross-cutting UI behavior @core', () => {
  test('key navigation remains usable at a mobile viewport @medium @accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first().click();
    await expect(page.getByRole('link', { name: 'Tests', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Monitors', exact: true })).toBeVisible();
  });

  test('a list API failure renders an explicit error state without crashing navigation @high @negative', async ({ page }) => {
    await page.route('**/api/tests**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Injected E2E failure' }) });
    });
    await page.goto('/tests');
    await expect(page.getByText(/Injected E2E failure|failed to fetch|something went wrong/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  });
});
