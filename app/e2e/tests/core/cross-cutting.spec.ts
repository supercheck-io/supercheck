import { expect, test } from '../../fixtures/checkpoint.fixture';
import { waitForHydration } from '../../utils/hydration';

test.describe('Cross-cutting UI behavior @core', () => {
  test('key navigation remains usable at a mobile viewport @medium @accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await waitForHydration(page);
    const toggle = page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).first();
    await expect(toggle).toBeVisible();
    // The sidebar can hydrate after the root flag; retry a tap that landed before its handler attached.
    await expect(async () => {
      if (!(await page.getByRole('dialog').isVisible())) await toggle.click();
      await expect(page.getByRole('link', { name: 'Tests', exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
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
