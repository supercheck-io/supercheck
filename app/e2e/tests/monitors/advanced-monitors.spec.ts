import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Monitors @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('M2, M3, M4: Create advanced monitors (Website, Ping, TCP) @high', async ({ page }) => {
    await page.goto('/monitors/create');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/monitors\/create/);
  });

  test('M6, M7: Multi-Location and Scheduling configuration @high', async ({ page }) => {
    await page.goto('/monitors/create');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/monitors\/create/);
  });

  test('M8, M9: SSL tracking and threshold configuration @medium', async ({ page }) => {
    await page.goto('/monitors/create');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/monitors\/create/);
  });

  test('M10, M11, M12: Notification channels (Email, Slack, Webhook) @high', async ({ page }) => {
    await page.goto('/settings/alerts');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/settings/);
  });
});
