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
  const currentUrl = page.url();

  // If already logged in and not on auth pages, return early
  if (
    currentUrl !== 'about:blank' &&
    !currentUrl.includes('/sign-in') &&
    !currentUrl.includes('/sign-up') &&
    !currentUrl.includes('/forgot-password')
  ) {
    return;
  }

  // Navigate to home to check auth status if blank or on sign-in
  if (currentUrl === 'about:blank') {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }

  // If redirected to sign-in or currently on sign-in, perform login
  if (page.url().includes('/sign-in')) {
    if (!env.testUser.email || !env.testUser.password) {
      throw new Error(
        'E2E_TEST_USER credentials required for authenticated tests.\n' +
        'Set E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD in app/e2e/.env'
      );
    }

    const signInPage = new SignInPage(page);
    await signInPage.signIn(env.testUser.email, env.testUser.password);

    // Race URL redirect vs error alert visibility
    const errorLocator = page.locator('[role="alert"], .text-destructive, [data-testid*="error"]').first();
    const result = await Promise.race([
      page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15000 }).then(() => 'redirected' as const),
      errorLocator.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'error' as const).catch(() => 'timeout' as const),
    ]);

    if (result === 'error') {
      const errorText = await errorLocator.textContent().catch(() => '');
      throw new Error(`Login failed on sign-in page: ${errorText?.trim() || 'Unknown authentication error'}`);
    }

    if (page.url().includes('/sign-in')) {
      throw new Error('Login failed: did not redirect away from sign-in page within 15 seconds.');
    }

    await page.waitForLoadState('domcontentloaded');
  }
}
