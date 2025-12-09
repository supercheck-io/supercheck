/**
 * Authentication Helper for E2E Tests
 * 
 * Provides a loginIfNeeded function that can be used in beforeEach hooks
 * to ensure the user is authenticated before running tests.
 */

import { Page } from '@playwright/test';
import { SignInPage } from '../pages/auth';
import { env } from './env';

/**
 * Login helper for authenticated tests.
 * Ensures user is authenticated before test runs.
 *
 * Usage in test file:
 * ```
 * test.beforeEach(async ({ page }) => {
 *   await loginIfNeeded(page);
 * });
 * ```
 */
export async function loginIfNeeded(page: Page): Promise<void> {
  // Navigate to home to check auth status
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Give time for redirect
  await page.waitForTimeout(1500);

  // If on sign-in page, login
  if (page.url().includes('/sign-in')) {
    if (!env.testUser.email || !env.testUser.password) {
      throw new Error(
        'E2E_TEST_USER credentials required for authenticated tests.\n' +
        'Set E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD in app/e2e/.env'
      );
    }
    const signInPage = new SignInPage(page);
    await signInPage.signIn(env.testUser.email, env.testUser.password);

    // Wait for redirect away from sign-in with more generous timeout
    try {
      await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 30000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1500);
    } catch (error) {
      // If still on sign-in page, check if there's an error message
      if (page.url().includes('/sign-in')) {
        const errorVisible = await page.locator('[role="alert"], .error, [data-testid="error-message"]').first().isVisible().catch(() => false);
        if (errorVisible) {
          const errorText = await page.locator('[role="alert"], .error, [data-testid="error-message"]').first().textContent().catch(() => '');
          throw new Error(`Login failed: ${errorText}`);
        }
        throw new Error('Login did not redirect from sign-in page. Check credentials or rate limiting.');
      }
    }
  }
}
