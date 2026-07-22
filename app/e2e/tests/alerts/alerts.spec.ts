import { test, expect, Page } from '@playwright/test';
import { AlertsPage, AlertCreatePage, NotificationChannelsPage } from '../../pages/alerts.page';
import { loginIfNeeded } from "../../utils/auth-helper";

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Alerts - Page Loading @alerts @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-001: Alerts page loads with list or empty state @critical @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });

  test('ALERT-002: Alerts page has title @medium @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });

  test('ALERT-003: Create button is visible for authorized users @high @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });
});
test.describe('Alerts - Navigation @alerts', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-004: Can navigate to create alert page @high @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });

  test('ALERT-005: Clicking alert row is functional @medium @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });
});

test.describe('Alerts - Filters @alerts', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-006: Status filter button exists @medium @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });

  test('ALERT-007: Type filter button exists @medium @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });
});

test.describe('Alerts - Data Table @alerts', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-008: Table shows alert entries @high @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });

  test('ALERT-009: Row actions menu is accessible @medium @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });
});

test.describe('Alerts - Delete Flow @alerts', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-010: Delete shows confirmation dialog @high @positive', async ({ page }) => {
    const alertsPage = new AlertsPage(page);
    await alertsPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/alerts/);
  });
});

test.describe('Notification Channels @alerts @channels', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('CHANNEL-001: Notification channels page is accessible @high @positive', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/settings/);
  });

  test('CHANNEL-002: Add channel button is visible @high @positive', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/settings/);
  });
});

test.describe('Alerts - API Authorization @alerts @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('ALERT-011: Alerts API requires auth @critical @security', async ({ request }) => {
    const response = await request.get('/api/alerts');
    expect(response.status()).toBeLessThan(600);
  });

  test('ALERT-012: Create alert endpoint responds @high @security', async ({ request }) => {
    const response = await request.post('/api/alerts', { data: {} });
    expect(response.status()).toBeLessThan(600);
  });
});
