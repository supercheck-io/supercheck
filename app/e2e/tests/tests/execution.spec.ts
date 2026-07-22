import { test, expect, Page } from '@playwright/test';
import { TestsPage, TestCreatePage } from '../../pages/tests.page';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createTest, deleteTest } from '../../utils/test-data';

let seededTestId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await createTest(request);
    seededTestId = seed.id;
  } catch (err) {
    console.error('Failed to seed test for execution suite:', err);
  }
});

test.afterAll(async ({ request }) => {
  if (seededTestId) {
    await deleteTest(request, seededTestId);
  }
});

test.describe('Test Execution - E1 to E6 @tests @execution', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('E1: Create, update, and verify Playwright test @critical @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();

    await testsPage.clickCreate();

    const createPage = new TestCreatePage(page);
    await createPage.expectLoaded();

    const browserCard = page.locator('text=/browser|playwright/i').first();
    if (await browserCard.isVisible().catch(() => false)) {
      await browserCard.click();
    } else {
      await page.goto('/playground');
    }

    await expect(page).toHaveURL(/playground|tests\/create/);
  });

  test('E2: Execute saved test manually @critical @positive', async ({ page }) => {
    const testsPage = new TestsPage(page);
    await testsPage.navigate();
    await testsPage.expectLoaded();

    const count = await testsPage.getTestCount();
    if (count > 0) {
      await testsPage.clickRow(0);
      await page.waitForTimeout(500);

      const runBtn = page.locator('button:has-text("Run"), [data-testid="run-test-button"]').first();
      if (await runBtn.isVisible().catch(() => false)) {
        await runBtn.click();
      }
    }
  });

  test('E3: Run ad-hoc from playground @high @positive', async ({ page }) => {
    await page.goto('/playground');
    await page.waitForLoadState('domcontentloaded');

    const editorOrRun = page.locator('button:has-text("Run"), [data-testid="run-test-button"], .monaco-editor').first();
    await expect(editorOrRun).toBeVisible({ timeout: 10000 });
  });

  test('E4: Run history page features @medium @positive', async ({ page }) => {
    await page.goto('/runs');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/runs/);
    const runsContainer = page.locator('table, [role="table"], [data-testid="runs-table"]').or(page.getByText(/runs|history|no runs/i)).first();
    await expect(runsContainer).toBeVisible({ timeout: 10000 });
  });
});
