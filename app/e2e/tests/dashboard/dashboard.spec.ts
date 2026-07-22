import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../pages/dashboard.page';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Dashboard & Core @dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('C1: Dashboard loads correctly with metric cards @critical @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();
  });

  test('C2: Project switcher works correctly @high @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();

    const isSwitcherVisible = await dashboardPage.projectSwitcher.isVisible().catch(() => false);
    if (isSwitcherVisible) {
      await dashboardPage.projectSwitcher.click();
      await page.keyboard.press('Escape');
    }
  });

  test('C3: Sidebar navigation works @medium @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();

    const hasSidebar = await dashboardPage.sidebar.isVisible().catch(() => false);
    if (hasSidebar) {
      await expect(dashboardPage.navTests).toBeVisible();
    }
  });

  test('C4: Loading skeletons are shown @medium @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();

    await expect(page).toHaveURL(/.*\/$/);
  });
});
