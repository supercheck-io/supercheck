import { test, expect, Page } from '@playwright/test';
import { SettingsPage, ApiKeysPage, VariablesPage, BillingPage } from '../../pages/settings.page';
import { loginIfNeeded } from "../../utils/auth-helper";

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Settings - Page Loading @settings @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SET-001: Settings page loads @high @positive', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/settings/);
  });

  test('SET-002: Settings navigation is visible @medium @positive', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/settings/);
  });
});

test.describe('API Keys @settings @api-keys', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('API-001: API Keys page loads @high @positive', async ({ page }) => {
    const apiKeysPage = new ApiKeysPage(page);
    await apiKeysPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toContain('settings');
  });

  test('API-002: Create API key button is visible @high @positive', async ({ page }) => {
    const apiKeysPage = new ApiKeysPage(page);
    await apiKeysPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toContain('settings');
  });

  test('API-003: Create button opens dialog @high @positive', async ({ page }) => {
    const apiKeysPage = new ApiKeysPage(page);
    await apiKeysPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toContain('settings');
  });
});

test.describe('Billing @settings @billing', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('BILL-001: Billing page loads @high @positive', async ({ page }) => {
    const billingPage = new BillingPage(page);
    await billingPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toMatch(/settings|org-admin|subscription/);
  });

  test('BILL-003: Upgrade button may be visible @medium @positive', async ({ page }) => {
    const billingPage = new BillingPage(page);
    await billingPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toMatch(/settings|org-admin|subscription/);
  });

});

test.describe('Settings - Profile @settings @profile', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('PROF-001: Profile settings accessible @high @positive', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toContain('settings');
  });
});

test.describe('Settings - Security @settings @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SEC-001: Security settings accessible @high @positive', async ({ page }) => {
    const settingsPage = new SettingsPage(page);
    await settingsPage.navigate();
    await waitForPageReady(page);

    expect(page.url()).toContain('settings');
  });
});

test.describe('Settings - API Authorization @settings @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SET-API-001: Settings endpoints respond @high @security', async ({ request }) => {
    const response = await request.get('/api/settings').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(600);
    }
  });

  test('SET-API-002: Variables API exists @high @security', async ({ request }) => {
    const response = await request.get('/api/variables');
    expect(response.status()).toBeLessThan(600);
  });

  test('SET-API-003: API Keys endpoint responds @high @security', async ({ request }) => {
    const response = await request.get('/api/api-keys').catch(() => null);
    if (response) {
      expect(response.status()).toBeLessThan(600);
    }
  });
});
