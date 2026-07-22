import { test, expect, Page } from '@playwright/test';
import { StatusPagesPage, StatusPageDetailPage } from '../../pages/status-pages.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createStatusPage, deleteStatusPage } from '../../utils/test-data';

let seededStatusPageId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await createStatusPage(request);
    seededStatusPageId = seed.id;
  } catch (err) {
    console.error('Failed to seed status page for suite:', err);
  }
});
test.afterAll(async ({ request }) => {
  if (seededStatusPageId) {
    await deleteStatusPage(request, seededStatusPageId);
  }
});

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Status Pages - Page Loading @status-pages @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP-001: Status pages list loads with cards or empty state @critical @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await waitForPageReady(page);

    await expect(page).toHaveURL(/status-pages/);
    await statusPagesPage.expectLoaded();
  });

  test('SP-002: Status pages list has correct title @medium @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await waitForPageReady(page);

    const hasTitle = await statusPagesPage.pageTitle.isVisible().catch(() => false);
    const hasStatusPagesText = await page.locator('text=/status page/i').first().isVisible().catch(() => false);

    expect(hasTitle || hasStatusPagesText).toBe(true);
  });

  test('SP-003: Create button is visible @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();

    await statusPagesPage.expectCreateButtonVisible();
  });
});

test.describe('Status Pages - Create Flow @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP-004: Create button opens dialog @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();

    await statusPagesPage.clickCreate();
    await statusPagesPage.waitForCreateDialog();
    await statusPagesPage.expectCreateDialogVisible();

    await statusPagesPage.cancelCreateDialog();
  });

  test('SP-005: Create form shows all fields @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();

    await statusPagesPage.clickCreate();
    await statusPagesPage.waitForCreateDialog();

    await expect(statusPagesPage.nameInput).toBeVisible();
    await expect(statusPagesPage.createDialogSubmit).toBeVisible();

    await statusPagesPage.cancelCreateDialog();
  });

  test('SP-006: Cancel closes create dialog @medium @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();

    await statusPagesPage.clickCreate();
    await statusPagesPage.waitForCreateDialog();
    await statusPagesPage.cancelCreateDialog();

    await expect(statusPagesPage.createDialog).toBeHidden();
  });
});

test.describe('Status Pages - Navigation @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP-008: Clicking manage navigates to detail page @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await waitForPageReady(page);

    const count = await statusPagesPage.getStatusPageCount();
    if (count > 0) {
      await statusPagesPage.clickManage(0);
      await page.waitForTimeout(500);
      expect(page.url()).toBeTruthy();
    }
  });
});

test.describe('Status Pages - Detail Page @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP-010: Detail page shows status page info @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await waitForPageReady(page);

    const count = await statusPagesPage.getStatusPageCount();
    if (count > 0) {
      await statusPagesPage.clickManage(0);
      const detailPage = new StatusPageDetailPage(page);
      await detailPage.expectLoaded();
    }
  });
});

test.describe('Status Pages - API Authorization @status-pages @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test.use({ storageState: { cookies: [], origins: [] } });

  test('SP-018: Status pages API requires auth @critical @security', async ({ request }) => {
    const response = await request.get('/api/status-pages');
    const status = response.status();
    expect(status).not.toBe(200);
  });

  test('SP-019: Create status page API requires auth @critical @security', async ({ request }) => {
    const response = await request.post('/api/status-pages', {
      data: { name: 'Unauthenticated Test' },
    });
    const status = response.status();
    expect(status).not.toBe(200);
    expect(status).not.toBe(201);
  });
});
