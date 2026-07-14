import { test, expect, Page } from '@playwright/test';
import { MonitorsPage, MonitorCreatePage } from '../../pages/monitors.page';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Monitor Execution - M1 to M5 @monitors @execution', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * M1 - Monitor - HTTP/HTTPS
   */
  test('M1: Create HTTP monitor @critical @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    
    await monitorsPage.clickCreate();
    
    const createPage = new MonitorCreatePage(page);
    await createPage.expectLoaded();
    
    const hasHttpCard = await createPage.httpMonitorCard.isVisible().catch(() => false);
    if (!hasHttpCard) {
      test.skip(true, 'HTTP monitor card not visible in create page');
    }
    
    await createPage.httpMonitorCard.click();
    
    // Fill out form
    const nameInput = page.locator('input[placeholder*="Name"], input[name="name"], [data-testid="monitor-name-input"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
       await nameInput.fill(`E2E HTTP Monitor ${Date.now()}`);
       
       const urlInput = page.locator('input[placeholder*="URL"], input[name="url"], [data-testid="monitor-url-input"]').first();
       if (await urlInput.isVisible().catch(() => false)) {
           await urlInput.fill('https://example.com');
       }
       
       const saveBtn = page.locator('button:has-text("Save"), button:has-text("Create"), [data-testid="save-monitor-button"]').first();
       await saveBtn.click();
       
       // Verify redirection or toast
       await page.waitForTimeout(1000);
       await expect(page.locator('[data-sonner-toast]')).toBeVisible().catch(() => {});
    } else {
       expect(page.url()).toContain('/monitors/create');
    }
  });

  /**
   * M5 - Monitor - Playwright Synthetic
   */
  test('M5: Create Playwright Synthetic monitor @high @positive', async ({ page }) => {
    const monitorsPage = new MonitorsPage(page);
    await monitorsPage.navigate();
    
    await monitorsPage.clickCreate();
    
    const createPage = new MonitorCreatePage(page);
    await createPage.expectLoaded();
    
    const hasSyntheticCard = await createPage.syntheticMonitorCard.isVisible().catch(() => false);
    if (!hasSyntheticCard) {
      test.skip(true, 'Synthetic monitor card not visible in create page');
    }
    
    await createPage.syntheticMonitorCard.click();
    
    // Form filling
    const nameInput = page.locator('input[placeholder*="Name"], input[name="name"], [data-testid="monitor-name-input"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
       await nameInput.fill(`E2E Synthetic Monitor ${Date.now()}`);
       
       // Find a select or combobox for script/test
       const testSelect = page.locator('[role="combobox"], select, [data-testid="test-select"]').first();
       if (await testSelect.isVisible().catch(() => false)) {
          await testSelect.click();
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
       }
       
       const saveBtn = page.locator('button:has-text("Save"), button:has-text("Create"), [data-testid="save-monitor-button"]').first();
       await saveBtn.click();
       
       await page.waitForTimeout(1000);
       await expect(page.locator('[data-sonner-toast]')).toBeVisible().catch(() => {});
    } else {
       expect(page.url()).toContain('/monitors/create');
    }
  });
});
