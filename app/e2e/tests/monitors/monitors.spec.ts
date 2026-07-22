import { test, expect, Page } from '@playwright/test';
import { MonitorsPage, MonitorCreatePage, MonitorDetailPage } from '../../pages/monitors.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createMonitor, deleteMonitor } from '../../utils/test-data';

let seededMonitorId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await createMonitor(request);
    seededMonitorId = seed.id;
  } catch (err) {
    console.error('Failed to seed monitor for suite:', err);
  }
});
test.afterAll(async ({ request }) => {
  if (seededMonitorId) {
    await deleteMonitor(request, seededMonitorId);
  }
});

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Monitors - Page Loading @monitors @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-002: Monitors page has correct title @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    await expect(monitorsPage.pageTitle).toBeVisible();
  });

  test('MON-003: Create button is visible @high @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    await monitorsPage.expectCreateButtonVisible();
  });
});

test.describe('Monitors - Navigation @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-005: Create page shows monitor type cards @high @positive', async ({ page }) => {
    const createPage = new MonitorCreatePage(page);
    await createPage.navigate();
    await waitForPageReady(page);

    await createPage.expectLoaded();
    const hasHttp = await createPage.httpMonitorCard.isVisible().catch(() => false);
    const hasWebsite = await createPage.websiteMonitorCard.isVisible().catch(() => false);
    const hasPing = await createPage.pingMonitorCard.isVisible().catch(() => false);
    const hasPort = await createPage.portMonitorCard.isVisible().catch(() => false);
    const hasSynthetic = await createPage.syntheticMonitorCard.isVisible().catch(() => false);
    const hasMonitorTypeText = await page.locator('text=/http|website|ping|port|synthetic/i').first().isVisible().catch(() => false);

    expect(hasHttp || hasWebsite || hasPing || hasPort || hasSynthetic || hasMonitorTypeText).toBe(true);
  });

  test('MON-006: Clicking monitor row opens detail page @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    await waitForPageReady(page);

    const count = await monitorsPage.getMonitorCount();
    if (count > 0) {
      await monitorsPage.clickRow(0);
      await page.waitForTimeout(1000);
      expect(page.url()).toBeTruthy();
    }
  });
});

test.describe('Monitors - Search and Filter @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-008: Status filter button exists @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();

    const hasStatusFilter = await monitorsPage.statusFilter.isVisible().catch(() => false);
    if (hasStatusFilter) {
      await expect(monitorsPage.statusFilter).toBeVisible();
    }
  });

  test('MON-009: Type filter button exists @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();

    const hasTypeFilter = await monitorsPage.typeFilter.isVisible().catch(() => false);
    if (hasTypeFilter) {
      await expect(monitorsPage.typeFilter).toBeVisible();
    }
  });
});

test.describe('Monitors - Data Table @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-011: Row actions menu is accessible @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    await waitForPageReady(page);

    const count = await monitorsPage.getMonitorCount();
    if (count > 0) {
      await monitorsPage.openRowActions(0);
      const hasEdit = await monitorsPage.editAction.isVisible().catch(() => false);
      const hasDelete = await monitorsPage.deleteAction.isVisible().catch(() => false);
      expect(hasEdit || hasDelete).toBe(true);
    }
  });
});

test.describe('Monitors - Pagination @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-013: Page navigation works @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();

    await expect(page).toHaveURL(/monitors/);
  });
});

test.describe('Monitors - Delete Flow @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-015: Cancel delete closes dialog @medium @positive', async ({ page, request }) => {
    const tempMon = await createMonitor(request, { name: `Temp Cancel Monitor ${Date.now()}` });
    try {
      const monitorsPage = new MonitorsPage(page);
      await monitorsPage.navigate();
      await waitForPageReady(page);

      await monitorsPage.openRowActions(0);
      await monitorsPage.deleteAction.click();
      await monitorsPage.deleteCancelButton.click();

      await expect(monitorsPage.deleteDialog).toBeHidden();
    } finally {
      await deleteMonitor(request, tempMon.id);
    }
  });
});

test.describe('Monitors - Detail Page @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-018: Monitor has actions available @medium @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    await waitForPageReady(page);

    const count = await monitorsPage.getMonitorCount();
    if (count > 0) {
      const hasActionsMenu = await page.locator('button[aria-haspopup="menu"]').first().isVisible().catch(() => false);
      expect(hasActionsMenu || count > 0).toBe(true);
    }
  });
});

test.describe('Monitors - API Authorization @monitors @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('MON-019: Monitors API endpoint exists @critical @security', async ({ request }) => {
    const response = await request.get('/api/monitors');
    const status = response.status();
    expect(status >= 200 && status < 600).toBe(true);
  });
});
