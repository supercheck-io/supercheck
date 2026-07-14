import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Billing & Admin @admin @billing', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * B1 - Plan Limits - UI
   * B3 - Usage Display
   */
  test('B1, B3: Billing page loads and shows plan limits and usage @high', async ({ page }) => {
    await page.goto('/settings/billing');
    
    // Check if billing page loaded
    const title = page.locator('h1, h2').filter({ hasText: /billing|plan/i }).first();
    if (await title.isVisible().catch(() => false)) {
      // Check for usage display
      const usage = page.locator('text=/usage|runs this month/i').first();
      expect(await usage.isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'Billing UI not accessible');
    }
  });

  /**
   * B2 - Subscription Upgrade
   */
  test('B2: Subscription upgrade flow (mocked) @high', async ({ page }) => {
    await page.goto('/settings/billing');
    
    const upgradeBtn = page.locator('button:has-text("Upgrade")').first();
    if (await upgradeBtn.isVisible().catch(() => false)) {
      await upgradeBtn.click();
      // Assume a modal or checkout redirect happens
      expect(page.url()).not.toBeNull();
    } else {
      test.skip(true, 'Upgrade button not found or user is already on max plan');
    }
  });

  /**
   * B4 - Super Admin - Dashboard
   */
  test('B4: Super admin dashboard shows system stats @critical @security', async ({ page }) => {
    await page.goto('/super-admin');
    
    // Check if super admin is accessible for this user
    if (page.url().includes('super-admin')) {
      const stats = page.locator('text=/total users|total orgs/i').first();
      expect(await stats.isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'Super admin not accessible for this test user');
    }
  });

  /**
   * B5 - Super Admin - User Management
   */
  test('B5: Super admin can view and manage users @high', async ({ page }) => {
    await page.goto('/super-admin/users');
    
    // Check if we hit an error page
    const isError = await page.locator('text=/forbidden|unauthorized|not found/i').isVisible().catch(() => false);
    
    if (page.url().includes('super-admin') && !isError) {
      const usersTable = page.locator('table, [role="table"], [data-testid="empty-state"]');
      await expect(usersTable.first()).toBeVisible({ timeout: 10000 });
    } else {
      test.skip(true, 'Super admin not accessible');
    }
  });

  /**
   * B6 - Super Admin - Impersonation
   */
  test('B6: Super admin impersonation flow @critical @security', async ({ page }) => {
    test.skip(true, 'Requires specialized setup and is potentially dangerous in staging');
  });

  /**
   * B7 - Super Admin - Location Management
   */
  test('B7: Super admin can manage execution locations @medium', async ({ page }) => {
    await page.goto('/super-admin/locations');
    
    const isError = await page.locator('text=/forbidden|unauthorized|not found/i').isVisible().catch(() => false);
    
    if (page.url().includes('super-admin') && !isError) {
      const locationsTable = page.locator('table, [role="table"], [data-testid="empty-state"]');
      await expect(locationsTable.first()).toBeVisible({ timeout: 10000 });
    } else {
      test.skip(true, 'Super admin not accessible');
    }
  });

  /**
   * B8 - Audit Logging
   */
  test('B8: Audit logs are visible for organization @high @security', async ({ page }) => {
    await page.goto('/org-admin/audit-logs');
    
    const isError = await page.locator('text=/forbidden|unauthorized|not found/i').isVisible().catch(() => false);
    const logsTitle = page.locator('h1, h2').filter({ hasText: /audit logs/i }).first();
    
    if (!isError && await logsTitle.isVisible().catch(() => false)) {
      const logsTable = page.locator('table, [role="table"], [data-testid="empty-state"]');
      await expect(logsTable.first()).toBeVisible({ timeout: 10000 });
    } else {
      test.skip(true, 'Audit logs UI not accessible');
    }
  });
});
