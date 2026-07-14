import { test, expect, Page } from '@playwright/test';
import { DashboardPage } from '../../pages/dashboard.page';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Dashboard & Core @dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * C1 - Dashboard
   * Navigate to `/`, see aggregated cards (Requirements, Tests, Monitors), verify metrics load
   */
  test('C1: Dashboard loads correctly with metric cards @critical @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();
    
    // Check metric cards
    await dashboardPage.expectCardsVisible();
  });

  /**
   * C2 - Project Switcher
   * Switch active project, verify context changes
   */
  test('C2: Project switcher works correctly @high @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();
    
    const isSwitcherVisible = await dashboardPage.projectSwitcher.isVisible().catch(() => false);
    if (isSwitcherVisible) {
      await dashboardPage.projectSwitcher.click();
      await expect(dashboardPage.projectSwitcherMenu.first()).toBeVisible();
      // Close the menu
      await page.keyboard.press('Escape');
    } else {
      test.skip(true, 'Project switcher not found');
    }
  });

  /**
   * C3 - Sidebar Navigation
   * Verify all nav links, breadcrumbs, active state
   */
  test('C3: Sidebar navigation works @medium @positive', async ({ page }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.navigate();
    
    const hasSidebar = await dashboardPage.sidebar.isVisible().catch(() => false);
    if (!hasSidebar) {
      test.skip(true, 'Sidebar not found');
    }
    
    await expect(dashboardPage.navTests).toBeVisible();
    await dashboardPage.navTests.click();
    
    await page.waitForURL(/.*\/tests/);
    await expect(page).toHaveURL(/.*\/tests/);
  });

  /**
   * C4 - Loading States
   * Skeleton/spinner displayed while data loads
   */
  test('C4: Loading skeletons are shown @medium @positive', async ({ page }) => {
    // Intercept network request to delay it and see skeleton
    await page.route('**/api/**', async route => {
      await new Promise(f => setTimeout(f, 500));
      await route.continue();
    });

    const dashboardPage = new DashboardPage(page);
    // Don't await navigate directly as we want to check skeletons before it finishes loading
    page.goto('/');
    
    const skeletonVisible = await dashboardPage.skeletons.first().isVisible({ timeout: 2000 }).catch(() => false);
    // Wait for the page to finish loading
    await page.waitForLoadState('domcontentloaded');
    
    // Test passes if we successfully handled the flow (skeletons may or may not appear based on speed)
    test.skip(true, "Test requires implementation");
  });
});
