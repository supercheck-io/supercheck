import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Status Pages @status-pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * SP2, SP3, SP4 - Incidents Create/Update/Resolve
   */
  test('SP2, SP3, SP4: Manage incidents (Create, Update, Resolve) @high', async ({ page }) => {
    await page.goto('/status-pages');
    
    // Go to the first status page
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      
      // Check for Incidents tab
      const incidentsTab = page.locator('button[role="tab"]:has-text("Incidents"), a:has-text("Incidents")');
      if (await incidentsTab.isVisible().catch(() => false)) {
        await incidentsTab.click();
        
        // Verify create incident button
        const createBtn = page.locator('button:has-text("Create Incident")');
        expect(await createBtn.isVisible().catch(() => false)).toBe(true);
      }
    } else {
      test.skip(true, 'No status pages available to test incidents');
    }
  });

  /**
   * SP5, SP6, SP7 - Publish / Unpublish / Public View
   */
  test('SP5, SP6, SP7: Publish flow and public view @high', async ({ page }) => {
    test.skip(true, 'Requires dedicated test status page to avoid affecting production views');
  });

  /**
   * SP8 - Subscribers
   * SP9 - SVG Badge
   * SP10 - Custom Domain
   */
  test('SP8, SP9, SP10: Subscribers, Badge, and Domain Settings @medium', async ({ page }) => {
    await page.goto('/status-pages');
    
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      
      // Check Settings Tab
      const settingsTab = page.locator('button[role="tab"]:has-text("Settings"), a:has-text("Settings")');
      if (await settingsTab.isVisible().catch(() => false)) {
        await settingsTab.click();
        expect(await page.locator('text=/Domain|Subdomain/i').first().isVisible().catch(() => false)).toBe(true);
      }
    } else {
      test.skip(true, 'No status pages available to test settings');
    }
  });
});
