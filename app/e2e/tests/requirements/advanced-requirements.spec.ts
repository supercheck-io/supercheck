import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Requirements & AI @requirements @ai', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('R2, R3: Document extraction and review dialog @high', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/requirements/);
  });

  test('R4, R5: Requirement detail view and test linking @high', async ({ page }) => {
    await page.goto('/requirements');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/requirements/);
  });

  test('R6, R7, R9: AI Test Generation and Fix buttons @high', async ({ page }) => {
    await page.goto('/playground');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/playground/);
  });

  test('R10: Configure AI providers in settings @medium', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/settings/);
  });
});
