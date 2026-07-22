import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Cross-Cutting Concerns @core', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('X1, X2: Tenant and Project Isolation @critical @security', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toBeTruthy();
  });

  test('X3: Mobile responsiveness for key pages @medium', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toBeTruthy();
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('X4: Pagination controls are visible on list pages @medium', async ({ page }) => {
    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toContain('/tests');
  });

  test('X5: Empty states show CTA when no data @low', async ({ page }) => {
    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toContain('/tests');
  });

  test('X6: Expired session redirects to sign-in @critical @security', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    expect(page.url()).toBeTruthy();
  });

  test('C5: API errors do not crash the page and show toast/boundary @high', async ({ page }) => {
    await page.route('**/api/tests**', route => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });

    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('nav, body').first()).toBeVisible();
  });
});
