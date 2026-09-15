/**
 * Password Reset Tests
 *
 * Tests for the password reset flow including:
 * - Forgot password page
 * - Reset password page
 * - Token validation
 * - Rate limiting
 *
 * Based on spec: specs/auth/password-reset.md
 * Test IDs: AUTH-009, AUTH-010, AUTH-011, AUTH-046
 */

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

import { ForgotPasswordPage } from '../../pages/auth';
import { routes, generateTestEmail } from '../../utils/env';

test.describe('Forgot Password @auth @password-reset', () => {
  /**
   * AUTH-009: Forgot password page loads correctly
   * @priority critical
   * @type positive
   */
  test('AUTH-009: Forgot password page loads with form @critical @positive', async ({ page }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    // Verify page structure
    await expect(page).toHaveURL(/forgot-password/);
    await expect(forgotPasswordPage.emailInput).toBeVisible();
    await expect(forgotPasswordPage.submitButton).toBeVisible();
  });

  /**
   * AUTH-009: Request password reset with valid email
   * @priority critical
   * @type positive
   */
  test('AUTH-009: Request password reset shows success @critical @positive', async ({ page }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    // Use a test email (doesn't need to exist for success message)
    const testEmail = generateTestEmail('password-reset');
    await forgotPasswordPage.requestReset(testEmail);

    // Should show success message (even if email doesn't exist for security)
    await forgotPasswordPage.expectSuccess();
  });

  /**
   * Test empty email - button is disabled
   * @priority medium
   * @type negative
   *
   * The submit button is disabled when email is empty (disabled={isLoading || !email})
   */
  test('Empty email - submit button is disabled @medium @negative', async ({ page }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    // Submit button should be disabled when email is empty
    const submitButton = page.locator('[data-testid="forgot-password-submit"]')
      .or(page.locator('button[type="submit"]'));

    await expect(submitButton).toBeDisabled();

    // Should stay on page
    await expect(page).toHaveURL(/forgot-password/);
  });

  /**
   * Test invalid email format
   * @priority medium
   * @type negative
   */
  test('Invalid email format shows error @medium @negative', async ({ page }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    // Enter invalid email
    await forgotPasswordPage.fillEmail('not-an-email');

    // Native email validation prevents the invalid value from being submitted.
    expect(
      await forgotPasswordPage.emailInput.evaluate(
        (element) => (element as HTMLInputElement).validity.valid,
      ),
    ).toBe(false);
    await expect(page).toHaveURL(/forgot-password/);
  });

  /**
   * Test navigation back to sign-in
   * @priority medium
   * @type positive
   */
  test('Can navigate back to sign-in @medium @positive', async ({ page }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    await forgotPasswordPage.clickBackToSignIn();
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe('Reset Password Page @auth @password-reset', () => {
  /**
   * AUTH-010: Reset password with invalid token shows form with error handling
   * @priority high
   * @type negative
   *
   * The reset password page loads and shows a form. When a user tries to submit
   * with an invalid token, the form submission will fail with an error.
   * The page initially shows the form regardless of token validity.
   */
  test('AUTH-010: Invalid reset token is rejected after valid form submission @high @negative', async ({ page }) => {
    await page.goto('/reset-password?token=invalid-token-12345');
    await page.getByLabel('New Password', { exact: true }).fill('ValidPass123');
    await page.getByLabel('Confirm New Password').fill('ValidPass123');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(page.getByText(/invalid|expired/i)).toBeVisible();
    await expect(page).toHaveURL(/reset-password\?token=invalid-token-12345/);
  });

  /**
   * AUTH-010: Reset password with expired token
   * @priority high
   * @type negative
   *
   * Similar to invalid token - the page loads and validates on submission
   */
  test('AUTH-010: Expired reset token is rejected @high @negative', async ({ page }) => {
    await page.goto('/reset-password?token=expired-token-12345');
    await page.getByLabel('New Password', { exact: true }).fill('ValidPass123');
    await page.getByLabel('Confirm New Password').fill('ValidPass123');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(page.getByText(/invalid|expired/i)).toBeVisible();
  });

  /**
   * Reset password page without token shows error
   * @priority high
   * @type negative
   *
   * Without a token, the page shows an error message about missing token
   * or shows a loading state while useEffect runs.
   */
  test('Reset password without token shows error @high @negative', async ({ page }) => {
    await page.goto('/reset-password');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/reset-password$/);
    await expect(
      page.getByText('Invalid or missing reset token. Please request a new password reset.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeDisabled();
  });
});

test.describe('Password Reset - Form Validation @auth @password-reset', () => {
  /**
   * Test that reset form requires matching passwords
   * Note: This test requires a valid token, so it's marked as skip
   */
  test('Passwords must match on reset @medium @negative', async ({ page }) => {
    await page.goto('/reset-password?token=client-validation-token');

    // Fill mismatched passwords
    await page.getByLabel('New Password', { exact: true }).fill('NewPassword123!');
    await page.getByLabel('Confirm New Password').fill('DifferentPassword123!');
    await page.getByRole('button', { name: 'Reset password' }).click();

    // Should show mismatch error
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  /**
   * Test password strength validation
   * Note: This test requires a valid token, so it's marked as skip
   */
  test('Weak password shows validation error @medium @negative', async ({ page }) => {
    await page.goto('/reset-password?token=client-validation-token');

    // Fill weak password
    await page.getByLabel('New Password', { exact: true }).fill('weak');
    await page.getByLabel('Confirm New Password').fill('weak');
    await page.getByRole('button', { name: 'Reset password' }).click();

    // Should show password strength error
    await expect(page.getByText('Password must be at least 8 characters long')).toBeVisible();
  });
});
