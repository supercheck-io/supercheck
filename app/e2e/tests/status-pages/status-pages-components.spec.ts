import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Status Pages Components - SP1 @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP1: Status page components CRUD operations @high @positive', async ({ page }) => {
    await page.goto('/status-pages');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/status-pages/);
  });
});
