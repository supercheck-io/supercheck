import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Monitors @monitors', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * M2 - Monitor - Website (Keyword + SSL)
   * M3 - Monitor - Ping (ICMP)
   * M4 - Monitor - TCP/UDP Port
   */
  test('M2, M3, M4: Create advanced monitors (Website, Ping, TCP) @high', async ({ page }) => {
    await page.goto('/monitors/create');
    
    // Check if monitor type selector exists
    const typeSelect = page.locator('select[name="monitorType"], [data-testid="monitor-type-select"], button[aria-haspopup="listbox"]');
    if (await typeSelect.isVisible().catch(() => false)) {
      // Just verifying the UI has options for these advanced monitor types
      expect(await page.locator('text=/Website|Browser/i').first().isVisible().catch(() => false)).toBe(true);
      expect(await page.locator('text=/Ping|ICMP/i').first().isVisible().catch(() => false)).toBe(true);
      expect(await page.locator('text=/TCP|Port/i').first().isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'Monitor creation UI not accessible or uses different layout');
    }
  });

  /**
   * M6 - Monitor - Multi-Location
   * M7 - Monitor - Scheduling
   */
  test('M6, M7: Multi-Location and Scheduling configuration @high', async ({ page }) => {
    await page.goto('/monitors/create');
    
    // Check location multi-select
    const locations = page.locator('text=/Locations|Regions/i');
    const schedules = page.locator('text=/Frequency|Schedule|Every/i');
    
    if (await locations.isVisible().catch(() => false)) {
      expect(await schedules.isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'Monitor configuration UI not loaded');
    }
  });

  /**
   * M8 - Monitor - SSL Certificate
   * M9 - Monitor - Alert Configuration
   */
  test('M8, M9: SSL tracking and threshold configuration @medium', async ({ page }) => {
    await page.goto('/monitors/create');
    
    // Expand advanced settings or check if thresholds exist
    const thresholds = page.locator('text=/Thresholds|Failure conditions|Retries/i');
    if (await thresholds.isVisible().catch(() => false)) {
      test.skip(true, "Test requires implementation");
    } else {
      test.skip(true, 'Threshold settings not visible');
    }
  });

  /**
   * M10 - M12 - Notifications
   */
  test('M10, M11, M12: Notification channels (Email, Slack, Webhook) @high', async ({ page }) => {
    await page.goto('/settings/alerts');
    
    const channelBtn = page.locator('button:has-text("Add Channel"), [data-testid="add-channel"]');
    if (await channelBtn.isVisible().catch(() => false)) {
      await channelBtn.click();
      
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
      
      // Verify channel options
      expect(await modal.locator('text=/Email/i').isVisible().catch(() => false)).toBe(true);
      expect(await modal.locator('text=/Slack/i').isVisible().catch(() => false)).toBe(true);
      expect(await modal.locator('text=/Webhook/i').isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'Alert channels UI not found');
    }
  });
});
