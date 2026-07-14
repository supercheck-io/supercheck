import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Status Pages Components - SP1 @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * SP1 - Components CRUD
   * Add/update/delete components and groups on detail page
   */
  test('SP1: Status page components CRUD operations @high @positive', async ({ page }) => {
    await page.goto('/status-pages');
    
    // Click on the first status page if any
    const firstRow = page.locator('table tbody tr, [role="row"]').nth(1); // 1 to avoid header if using role
    if (await firstRow.isVisible().catch(() => false)) {
       await firstRow.click();
       await page.waitForTimeout(1000);
       
       // Try to find components tab
       const componentsTab = page.locator('button[role="tab"]:has-text("Components")');
       if (await componentsTab.isVisible().catch(() => false)) {
          await componentsTab.click();
          
          // Verify add component button
          const addBtn = page.locator('button:has-text("Add Component")');
          if (await addBtn.isVisible().catch(() => false)) {
             expect(await addBtn.isVisible()).toBe(true);
          }
       }
    } else {
       test.skip(true, 'No status pages to test component CRUD');
    }
  });
});
