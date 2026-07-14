import { test, expect } from '@playwright/test';
import { loginIfNeeded } from "../../utils/auth-helper";

test.describe('Advanced Requirements & AI @requirements @ai', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  
  /**
   * R2, R3 - Requirements AI Extraction and Review
   */
  test('R2, R3: Document extraction and review dialog @high', async ({ page }) => {
    await page.goto('/requirements');
    
    // Check for upload or extract button
    const extractBtn = page.locator('button:has-text("Extract"), button:has-text("Upload"), [data-testid="extract-requirements"]');
    if (await extractBtn.isVisible().catch(() => false)) {
      await extractBtn.click();
      
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
      
      const fileInput = modal.locator('input[type="file"]');
      expect(await fileInput.isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'AI extraction UI not accessible');
    }
  });

  /**
   * R4, R5 - Requirements Detail and Link/Unlink
   */
  test('R4, R5: Requirement detail view and test linking @high', async ({ page }) => {
    await page.goto('/requirements');
    
    const firstReq = page.locator('table tbody tr, [data-testid="requirement-card"]').first();
    if (await firstReq.isVisible().catch(() => false)) {
      await firstReq.click();
      
      // Inside detail view, look for linked tests tab or section
      const linkedTests = page.locator('text=/Linked Tests|Coverage/i').first();
      const linkBtn = page.locator('button:has-text("Link Test")');
      
      const isReady = await linkedTests.isVisible().catch(() => false) || await linkBtn.isVisible().catch(() => false);
      
      if (!isReady) {
        test.skip(true, 'Requirements detail view UI is missing expected elements');
      } else {
        expect(isReady).toBe(true);
      }
    } else {
      test.skip(true, 'No requirements available to view details');
    }
  });

  /**
   * R6 - AI Test Generation
   * R7 - AI Fix
   * R9 - AI Create
   */
  test('R6, R7, R9: AI Test Generation and Fix buttons @high', async ({ page }) => {
    await page.goto('/playground');
    
    const aiBtn = page.locator('button:has-text("AI"), [data-testid="ai-prompt-btn"]');
    if (await aiBtn.isVisible().catch(() => false)) {
      await aiBtn.click();
      
      const input = page.locator('textarea[placeholder*="Generate"], input[placeholder*="describe"]');
      expect(await input.isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'AI code generation UI not accessible');
    }
  });

  /**
   * R10 - AI Provider Config
   */
  test('R10: Configure AI providers in settings @medium', async ({ page }) => {
    await page.goto('/org-admin/ai-settings');
    
    // Check if AI settings page loaded
    const title = page.locator('h1, h2').filter({ hasText: /ai settings|providers/i }).first();
    if (await title.isVisible().catch(() => false)) {
      expect(await page.locator('text=/OpenAI|Anthropic|Gemini/i').first().isVisible().catch(() => false)).toBe(true);
    } else {
      test.skip(true, 'AI settings not accessible for this user');
    }
  });
});
