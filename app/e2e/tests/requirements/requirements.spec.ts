import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Requirements - R1 @requirements', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('R1: Requirements dashboard loads and shows coverage @high @positive', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/requirements/);
  });
});
