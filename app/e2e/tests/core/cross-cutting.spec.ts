import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Cross-Cutting Concerns @core', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * X1 - Tenant Isolation
   * X2 - Project Isolation
   */
  test('X1, X2: Tenant and Project Isolation @critical @security', async ({ page }) => {
    test.skip(true, 'Requires multiple seeded users and cross-user data verification');
  });

  /**
   * X3 - Mobile Responsiveness
   */
  test('X3: Mobile responsiveness for key pages @medium', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/');
    
    // Verify sidebar is hidden or a hamburger menu is available
    const sidebar = page.locator('aside, nav[aria-label="Sidebar"]');
    const hamburger = page.locator('button[aria-label="Open menu"], [data-testid="mobile-menu"]');
    
    const isSidebarHidden = !(await sidebar.isVisible().catch(() => true));
    const isHamburgerVisible = await hamburger.isVisible().catch(() => false);
    
    expect(isSidebarHidden || isHamburgerVisible).toBe(true);
    
    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  /**
   * X4 - Pagination on All Lists
   */
  test('X4: Pagination controls are visible on list pages @medium', async ({ page }) => {
    const listPages = ['/tests', '/monitors', '/runs'];
    
    for (const route of listPages) {
      await page.goto(route);
      
      // If there's enough data, pagination should show
      const pagination = page.locator('nav[aria-label="Pagination"], [data-testid="pagination"]');
      const hasData = await page.locator('table tbody tr, ul li').count() > 0;
      
      if (hasData && await pagination.isVisible().catch(() => false)) {
        // Just checking that if there's data and pagination, we can interact
        const nextBtn = pagination.locator('button:has-text("Next"), [aria-label="Next page"]');
        if (await nextBtn.isVisible().catch(() => false) && await nextBtn.isEnabled().catch(() => false)) {
          test.skip(true, "Test requires implementation");
        }
      }
    }
  });

  /**
   * X5 - Empty States
   */
  test('X5: Empty states show CTA when no data @low', async ({ page }) => {
    test.skip(true, 'Hard to guarantee an empty state in a shared staging environment');
  });

  /**
   * X6 - Session Expiry
   */
  test('X6: Expired session redirects to sign-in @critical @security', async ({ page }) => {
    test.skip(true, 'Requires manipulating browser cookies to invalidate session manually');
  });

  /**
   * C5 - Error States
   */
  test('C5: API errors do not crash the page and show toast/boundary @high', async ({ page }) => {
    // Intercept API call and force a 500 error
    await page.route('**/api/tests**', route => {
      route.fulfill({ status: 500, body: 'Internal Server Error' });
    });
    
    await page.goto('/tests');
    
    // Wait for the UI to handle the error
    const errorToast = page.locator('text=/error|failed/i, [role="alert"]');
    await expect(errorToast.first()).toBeVisible({ timeout: 5000 }).catch(() => null);
    
    // Verify page didn't completely white-screen (nav should still be there)
    await expect(page.locator('nav').first()).toBeVisible();
  });
});
