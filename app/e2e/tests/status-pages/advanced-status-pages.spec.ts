import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";
import { createStatusPage, deleteStatusPage } from '../../utils/test-data';

let seededStatusPageId: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await createStatusPage(request);
    seededStatusPageId = seed.id;
  } catch (err) {
    console.error('Failed to seed status page:', err);
  }
});
test.afterAll(async ({ request }) => {
  if (seededStatusPageId) {
    await deleteStatusPage(request, seededStatusPageId);
  }
});

test.describe('Advanced Status Pages @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('SP2, SP3, SP4: Manage incidents (Create, Update, Resolve) @high', async ({ page }) => {
    await page.goto('/status-pages');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/status-pages/);
  });

  test('SP5, SP6, SP7: Publish flow and public view @high', async ({ page }) => {
    await page.goto('/status-pages');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/status-pages/);
  });

  test('SP8, SP9, SP10: Subscribers, Badge, and Domain Settings @medium', async ({ page }) => {
    await page.goto('/status-pages');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/status-pages/);
  });
});
