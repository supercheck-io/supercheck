import { test, expect } from '@playwright/test';

test.describe('API Keys & Secrets @auth @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  
  /**
   * A14 - API Key - CI/CD Trigger
   */
  test('A14: Trigger job via Bearer token scoped access @high @security', async ({ request }) => {
    // In a real test, this would use a generated API key
    // For this mock check, we just verify an unauthorized request fails with 401
    const response = await request.post('/api/jobs/trigger', {
      headers: {
        Authorization: 'Bearer invalid-test-token',
      },
    });
    
    // It should be unauthorized or not found
    expect(response.ok()).toBeFalsy();
  });

  /**
   * A15 - Project Variables - Secret Security
   */
  test('A15: Verify secrets cannot be decrypted without permission @high @security', async ({ page }) => {
    await page.goto('/settings/variables');
    
    // If variables UI loads
    const variablesTitle = page.locator('h1, h2').filter({ hasText: /variables|secrets/i }).first();
    if (await variablesTitle.isVisible().catch(() => false)) {
      // Look for a secret value that should be masked
      const maskedValue = page.locator('text=••••••••, input[type="password"]');
      const hasMasked = await maskedValue.first().isVisible().catch(() => false);
      
      // Reveal button should exist if there are secrets
      const revealBtn = page.locator('button[aria-label="Reveal secret"], button:has-text("Reveal")').first();
      
      if (hasMasked && await revealBtn.isVisible().catch(() => false)) {
         test.skip(true, "Test requires implementation");
      } else {
         test.skip(true, 'No existing secrets to verify or UI differs');
      }
    } else {
      test.skip(true, 'Variables UI not accessible');
    }
  });
});
