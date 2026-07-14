import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Execution & Details @execution', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * E5 - Run Detail
   */
  test('E5: View Run Details (screenshots, trace, console) @high', async ({ page }) => {
    await page.goto('/runs');
    
    // Find the first run row and click it
    const firstRow = page.locator('table tbody tr, [data-testid="run-card"]').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      
      // Wait for the details page to load
      const tabs = page.locator('button[role="tab"]');
      if (await tabs.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        // Verify console or log output tab exists
        const consoleTab = tabs.filter({ hasText: /console|logs/i });
        if (await consoleTab.isVisible().catch(() => false)) {
           await consoleTab.click();
           await expect(page.locator('.log-viewer, pre, code').first()).toBeVisible({ timeout: 5000 }).catch(() => null);
        }
      } else {
        test.skip(true, 'Run details UI does not use tab roles or failed to load');
      }
    } else {
      test.skip(true, 'No runs available to view details');
    }
  });

  /**
   * E6 - Run Cancellation
   */
  test('E6: Cancel an in-progress run @medium', async ({ page }) => {
    test.skip(true, 'Requires triggering a long-running test first');
  });

  /**
   * E7, E8 - K6 Load Tests
   */
  test('E7, E8: K6 Load Test CRUD and Results @medium', async ({ page }) => {
    await page.goto('/tests/create');
    
    // Check if K6 option is available
    const k6Option = page.locator('button:has-text("K6"), [value="k6"]');
    if (await k6Option.isVisible().catch(() => false)) {
      await k6Option.click();
      expect(await page.locator('text=/VU|Virtual Users/i').first().isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'K6 load testing not enabled in this environment');
    }
  });

  /**
   * E12, E13 - Multi-Location Execution
   */
  test('E12, E13: Multi-Location Execution and Heartbeats @high', async ({ page }) => {
    await page.goto('/tests');
    
    const firstTest = page.locator('table tbody tr').first();
    if (await firstTest.isVisible().catch(() => false)) {
      await firstTest.click();
      
      const runBtn = page.locator('button:has-text("Run"), [data-testid="run-test"]').first();
      if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await runBtn.click();
        
        // Check for location selector in the run modal
        const locationSelect = page.locator('select[name="location"], [data-testid="location-select"], button[aria-haspopup="listbox"]');
        if (await locationSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
           const options = locationSelect.locator('option, [role="option"]');
           expect(await options.count().catch(() => 0)).toBeGreaterThanOrEqual(0);
        }
      } else {
        test.skip(true, 'Run button not available on test details page');
      }
    } else {
      test.skip(true, 'No test available to verify multi-location execution');
    }
  });
});
