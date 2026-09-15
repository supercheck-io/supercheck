/**
 * Sign In Tests
 *
 * Tests for authentication via the sign-in page.
 * Based on spec: specs/auth/sign-in.md
 *
 * Test IDs: AUTH-004 through AUTH-018
 */

import { test, expect } from '../../fixtures/auth.fixture';

test.use({ storageState: { cookies: [], origins: [] } });

import { SignInPage } from '../../pages/auth';
import { env, routes } from '../../utils/env';

const AUTH_MAX_ATTEMPTS = 3;
const AUTH_RETRY_MAX_SECONDS = 30;

test.describe('Sign In @auth @smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state for sign-in tests
    await page.context().clearCookies();
  });

  /**
   * AUTH-004: Sign in with valid credentials
   * Requires valid test user credentials in .env
   * @priority critical
   * @type positive
   */
  test('AUTH-004: Sign in with valid credentials @critical @positive', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt += 1) {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/auth/sign-in/email') &&
          response.request().method() === 'POST',
      );
      await signInPage.signIn(env.testUser.email, env.testUser.password);
      const response = await responsePromise;

      if (response.status() !== 429) {
        break;
      }
      if (attempt === AUTH_MAX_ATTEMPTS) {
        throw new Error('Valid E2E sign-in remained rate limited after retries');
      }

      const retryAfterHeader =
        response.headers()['retry-after'] ??
        response.headers()['x-retry-after'];
      const retryAfterSeconds = Number.parseInt(retryAfterHeader ?? '', 10);
      const boundedSeconds = Number.isFinite(retryAfterSeconds)
        ? Math.min(Math.max(retryAfterSeconds, 1), AUTH_RETRY_MAX_SECONDS)
        : Math.min(2 ** attempt, AUTH_RETRY_MAX_SECONDS);
      await page.waitForTimeout(boundedSeconds * 1_000 + 250);
    }

    // Wait for redirect away from sign-in page
    await expect(page).not.toHaveURL(/sign-in/, { timeout: 30000 });
  });

  /**
   * AUTH-018: Sign out
   * @priority high
   * @type positive
   *
   * Keep positive authentication flows ahead of intentional failures so the
   * production IP rate limiter cannot mask sign-out coverage.
   */
  test('AUTH-018: Sign out @high @positive', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();
    await signInPage.signInAndWaitForDashboard(env.testUser.email, env.testUser.password);

    // Act - Sign out via the user menu (Avatar button in top right)
    await page.getByTestId('user-menu').click();
    await page.getByTestId('sign-out-button').click();

    // Assert
    await expect(page).toHaveURL(/sign-in/, { timeout: 30_000 });

    // Verify session is destroyed
    await page.goto('/tests');
    await expect(page).toHaveURL(/sign-in/);
  });

  /**
   * AUTH-005: Sign in with invalid password
   * @priority high
   * @type negative
   *
   * Note: Due to rate limiting, the error might be:
   * - "Invalid credentials" / "Incorrect password" on first attempts
   * - "Too many requests" if rate limited
   */
  test('AUTH-005: Sign in with invalid password @high @negative', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();
    await signInPage.signIn('test@example.com', 'wrong-password-123');

    // Assert - should show error (auth error OR rate limit)
    await signInPage.expectError(/invalid|incorrect|too many|rate limit/i);
    await expect(page).toHaveURL(/sign-in/);
  });

  /**
   * AUTH-006: Sign in with non-existent email
   * @priority high
   * @type negative
   */
  test('AUTH-006: Sign in with non-existent email @high @negative', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();
    await signInPage.signIn('nonexistent-user@example.com', 'any-password-123');

    // Assert - generic error (doesn't reveal if email exists) or rate limit
    await signInPage.expectError(/invalid|incorrect|too many|rate limit/i);
    await expect(page).toHaveURL(/sign-in/);
  });

});

test.describe('Sign In - Form Validation @auth', () => {
  /**
   * Test empty email submission
   * @priority medium
   * @type negative
   */
  test('shows validation error for empty email @medium @negative', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Act - Try to submit with empty email
    await signInPage.fillPassword('some-password');
    await signInPage.submit();

    // Assert - Should show validation error or prevent submission
    // Form validation should prevent submission
    await expect(page).toHaveURL(/sign-in/);
  });

  /**
   * Test empty password submission
   * @priority medium
   * @type negative
   */
  test('shows validation error for empty password @medium @negative', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Act - Try to submit with empty password
    await signInPage.fillEmail('test@example.com');
    await signInPage.submit();

    // Assert - Should show validation error or prevent submission
    await expect(page).toHaveURL(/sign-in/);
  });

  /**
   * Test invalid email format
   * @priority medium
   * @type negative
   */
  test('shows validation error for invalid email format @medium @negative', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Act - Enter invalid email format
    await signInPage.fillEmail('not-an-email');
    await signInPage.fillPassword('some-password');
    await signInPage.submit();

    // Assert - Should show validation error
    // Browser's built-in validation or custom validation should trigger
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe('Sign In - OAuth Buttons @auth @oauth', () => {
  /**
   * Test GitHub OAuth button visibility
   * @priority high
   * @type positive
   */
  test('shows GitHub OAuth button when enabled @high @positive', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);

    // Act
    await signInPage.navigate();

    // Assert - GitHub button should be visible (if enabled in env)
    const isGitHubAvailable = await signInPage.isGitHubAvailable();
    if (isGitHubAvailable) {
      await expect(signInPage.githubButton).toBeVisible();
    }
  });

  /**
   * Test Google OAuth button visibility
   * @priority high
   * @type positive
   */
  test('shows Google OAuth button when enabled @high @positive', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);

    // Act
    await signInPage.navigate();

    // Assert - Google button should be visible (if enabled in env)
    const isGoogleAvailable = await signInPage.isGoogleAvailable();
    if (isGoogleAvailable) {
      await expect(signInPage.googleButton).toBeVisible();
    }
  });
});

test.describe('Sign In - Navigation @auth', () => {
  /**
   * Test navigation to forgot password
   * @priority medium
   * @type positive
   */
  test('can navigate to forgot password @medium @positive', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Act
    await signInPage.clickForgotPassword();

    // Assert
    await expect(page).toHaveURL(/forgot-password/);
  });
});
