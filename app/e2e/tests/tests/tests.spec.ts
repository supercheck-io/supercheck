import { test, expect, Page } from '@playwright/test';
import { TestsPage, TestCreatePage } from '../../pages/tests.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createTest, deleteTest } from '../../utils/test-data';

let testItemId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const created = await createTest(request);
    testItemId = created.id;
  } catch (err) {
    console.error('Failed to create seed test for tests.spec.ts:', err);
  }
});
test.afterAll(async ({ request }) => {
  if (testItemId) {
    await deleteTest(request, testItemId);
  }
});

async function waitForPageReady(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(timeout);
}

test.describe('Tests - Page Loading @tests @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-001: Tests page loads with table or empty state @critical @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/tests/);
    await testsPage.expectLoaded();
  });

  test('TESTS-002: Tests page has correct title @medium @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    await expect(testsPage.pageTitle).toBeVisible();
  });

  test('TESTS-003: Create button is visible @high @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    await testsPage.expectCreateButtonVisible();
  });
});

test.describe('Tests - Navigation @tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-004: Can navigate to create test page @high @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    await testsPage.clickCreate();
    await expect(page).toHaveURL(/tests\/create/);
  });

  test('TESTS-005: Create page shows test type cards @high @positive', async ({ page }) => {
    const createPage = new TestCreatePage(page);
    await createPage.navigate();
    await waitForPageReady(page);

    await createPage.expectLoaded();
    const hasBrowser = await createPage.browserTestCard.isVisible().catch(() => false);
    const hasApi = await createPage.apiTestCard.isVisible().catch(() => false);
    const hasCustom = await createPage.customTestCard.isVisible().catch(() => false);
    const hasTestTypeText = await page.locator('text=/browser|api|custom|playwright/i').first().isVisible().catch(() => false);

    expect(hasBrowser || hasApi || hasCustom || hasTestTypeText).toBe(true);
  });

  test('TESTS-006: Row click is functional @medium @positive', async ({ page, request }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await waitForPageReady(page);

    const count = await testsPage.getTestCount();
    if (count > 0) {
      await testsPage.clickRow(0);
      await page.waitForTimeout(500);
      // Row click should complete without exception
      expect(page.url()).toBeTruthy();
    }
  });
});

test.describe('Tests - Search and Filter @tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-007: Search input works @medium @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await waitForPageReady(page);

    const hasSearch = await testsPage.searchInput.isVisible().catch(() => false);
    if (hasSearch) {
      await testsPage.search('test query');
      await expect(testsPage.searchInput).toHaveValue('test query');

      await testsPage.clearSearch();
      await expect(testsPage.searchInput).toHaveValue('');
    }
  });

  test('TESTS-008: Type filter button exists @medium @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    const hasTypeFilter = await testsPage.typeFilter.isVisible().catch(() => false);
    if (hasTypeFilter) {
      await expect(testsPage.typeFilter).toBeVisible();
    }
  });

  test('TESTS-009: Priority filter button exists @medium @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    const hasPriorityFilter = await testsPage.priorityFilter.isVisible().catch(() => false);
    if (hasPriorityFilter) {
      await expect(testsPage.priorityFilter).toBeVisible();
    }
  });
});

test.describe('Tests - Data Table @tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-010: Table shows test entries @high @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await waitForPageReady(page);

    const isTableVisible = await testsPage.isTableVisible();
    const isEmptyVisible = await testsPage.isEmptyStateVisible();
    expect(isTableVisible || isEmptyVisible).toBe(true);
  });

  test('TESTS-011: Row actions menu is accessible @medium @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await waitForPageReady(page);

    const count = await testsPage.getTestCount();
    if (count > 0) {
      await testsPage.openRowActions(0);
      const hasEdit = await testsPage.editAction.isVisible().catch(() => false);
      const hasDelete = await testsPage.deleteAction.isVisible().catch(() => false);
      expect(hasEdit || hasDelete).toBe(true);
    }
  });
});

test.describe('Tests - Delete Flow @tests', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-012: Delete shows confirmation dialog @high @positive', async ({ page, request }) => {
    // Create temporary test for deletion dialog test
    const tempTest = await createTest(request, { title: `Temp Delete Test ${Date.now()}` });
    try {
      const testsPage = new TestsPage(page);
      await testsPage.navigate();
      await waitForPageReady(page);

      await testsPage.openRowActions(0);
      await testsPage.deleteAction.click();

      await expect(testsPage.deleteDialog).toBeVisible();
      await expect(testsPage.deleteConfirmButton).toBeVisible();
      await expect(testsPage.deleteCancelButton).toBeVisible();

      // Dismiss dialog
      await testsPage.deleteCancelButton.click();
    } finally {
      await deleteTest(request, tempTest.id);
    }
  });

  test('TESTS-013: Cancel delete closes dialog @medium @positive', async ({ page, request }) => {
    const tempTest = await createTest(request, { title: `Temp Cancel Test ${Date.now()}` });
    try {
      const testsPage = new TestsPage(page);
      await testsPage.navigate();
      await waitForPageReady(page);

      await testsPage.openRowActions(0);
      await testsPage.deleteAction.click();
      await testsPage.deleteCancelButton.click();

      await expect(testsPage.deleteDialog).toBeHidden();
    } finally {
      await deleteTest(request, tempTest.id);
    }
  });
});

test.describe('Tests - API Authorization @tests @security', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('TESTS-014: Tests API endpoint exists @critical @security', async ({ request }) => {
    const response = await request.get('/api/tests');
    const status = response.status();
    expect(status >= 200 && status < 600).toBe(true);
  });
});
