import { expect } from '@playwright/test';
import { test } from '../../fixtures';
import { StatusPagesPage, StatusPageDetailPage } from '../../pages/status-pages.page';
import { createStatusPageThroughUi } from '../../utils/status-page-test-data';

test.describe('Status Pages - Page Loading @status-pages @smoke', () => {
  test('SP-001: Status pages list loads with cards or empty state @critical @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await expect(page).toHaveURL(/\/status-pages$/);
    await expect(page.getByRole('heading', { name: 'Status Pages', exact: true })).toBeVisible();
    await expect(statusPagesPage.createButton).toBeVisible();
  });

  test('SP-002: Status pages list has correct title @medium @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();
    await expect(statusPagesPage.pageTitle).toBeVisible();
  });

  test('SP-003: Create button is visible @high @positive', async ({ page }) => {
    const statusPagesPage = new StatusPagesPage(page);
    await statusPagesPage.navigate();

    await statusPagesPage.expectCreateButtonVisible();
  });
});

test.describe('Status Pages - Create Flow @status-pages', () => {
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
  test('SP-008: Clicking manage navigates to the selected detail page @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);
    const card = page.getByTestId('status-page-card').filter({ hasText: created.name });
    await card.getByRole('link', { name: /manage/i }).click();

    await expect(page).toHaveURL(new RegExp(`/status-pages/${created.id}$`));
  });
});

test.describe('Status Pages - Detail Page @status-pages', () => {
  test('SP-010: Detail page shows the persisted status page @high @positive', async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const created = await createStatusPageThroughUi(page, request, cleanup);
    await page.goto(`/status-pages/${created.id}`, { waitUntil: 'domcontentloaded' });

    const detailPage = new StatusPageDetailPage(page);
    await detailPage.expectLoaded();
    await expect(detailPage.pageTitle).toContainText(created.name);
  });
});

test.describe('Status Pages - API Authorization @status-pages @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SP-018: Status pages API requires auth @critical @security', async ({ request }) => {
    const response = await request.get('/api/status-pages');
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});
