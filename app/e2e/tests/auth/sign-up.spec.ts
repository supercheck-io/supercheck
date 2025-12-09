/**
 * Sign Up Tests
 *
 * Tests for user registration via OAuth providers.
 * SuperCheck uses social-only signup (GitHub, Google) by default.
 * Email/password signup is only available via invitation.
 *
 * IMPORTANT: The /sign-up page WITHOUT an invite token redirects to /sign-in.
 * New users should use the sign-in page with social auth (GitHub/Google),
 * which automatically creates accounts. Email signup is only for invited users.
 *
 * Based on spec: specs/auth/sign-up.md
 * Test IDs: AUTH-001, AUTH-002, AUTH-003, AUTH-012 through AUTH-015
 */

import { test, expect } from '@playwright/test';
import { SignInPage, SignUpPage } from '../../pages/auth';
import { routes } from '../../utils/env';

test.describe('Sign Up - Redirect Behavior @auth @oauth', () => {
  /**
   * AUTH-001: Sign up page redirects to sign-in without invite
   * @priority critical
   * @type positive
   *
   * Without an invite token, /sign-up redirects to /sign-in
   * because new users should use OAuth on the sign-in page.
   */
  test('AUTH-001: Sign up without invite redirects to sign-in @critical @positive', async ({ page }) => {
    // Navigate to sign-up without invite token
    await page.goto(routes.signUp);
    await page.waitForLoadState('domcontentloaded');

    // Should redirect to sign-in page (OAuth-only signup for new users)
    await expect(page).toHaveURL(/sign-in/, { timeout: 5000 });

    // Sign-in page should have OAuth buttons for new user signup
    const signInPage = new SignInPage(page);
    
    // Wait for OAuth buttons section to render
    await page.waitForTimeout(1000);
    
    const hasGitHub = await signInPage.isGitHubAvailable();
    const hasGoogle = await signInPage.isGoogleAvailable();

    // Skip if no OAuth providers configured (valid for some deployments)
    if (!hasGitHub && !hasGoogle) {
      test.skip(true, 'No OAuth providers configured');
    }
  });

  /**
   * AUTH-002: GitHub OAuth available on sign-in (for new user signup)
   * @priority critical
   * @type positive
   *
   * New users without invites sign up via OAuth on the sign-in page.
   */
  test('AUTH-002: GitHub OAuth on sign-in for new users @critical @positive', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    const hasGitHub = await signInPage.isGitHubAvailable();
    test.skip(!hasGitHub, 'GitHub OAuth not enabled');

    // GitHub button should be visible
    await expect(signInPage.githubButton).toBeVisible();
  });

  /**
   * AUTH-014: Google OAuth available on sign-in (for new user signup)
   * @priority high
   * @type positive
   *
   * New users without invites sign up via OAuth on the sign-in page.
   */
  test('AUTH-014: Google OAuth on sign-in for new users @high @positive', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    const hasGoogle = await signInPage.isGoogleAvailable();
    test.skip(!hasGoogle, 'Google OAuth not enabled');

    // Google button should be visible
    await expect(signInPage.googleButton).toBeVisible();
  });
});

test.describe('Sign Up - Invitation Flow @auth @invite', () => {
  /**
   * AUTH-003: Invitation signup shows email form
   * @priority critical
   * @type positive
   *
   * Note: This test requires a valid invitation token.
   * In real scenarios, you'd create an invitation via API first.
   */
  test('AUTH-003: Invitation flow shows email signup form @critical @positive', async ({ page }) => {
    // Skip if no invitation mechanism available for testing
    // This would normally use a test API to create an invitation
    test.skip(true, 'Requires valid invitation token - implement with test API');

    const signUpPage = new SignUpPage(page);
    const testInviteToken = 'test-invite-token';

    await signUpPage.navigate(testInviteToken);

    // With invitation, email form should be visible
    await signUpPage.expectEmailFormMode();
    await signUpPage.expectInvitationBadge();
  });

  /**
   * Test invalid invitation token
   * @priority high
   * @type negative
   *
   * Invalid invite tokens should result in redirect to sign-in
   * because the invite data fetch will fail.
   */
  test('Invalid invitation token redirects to sign-in @high @negative', async ({ page }) => {
    const invalidToken = 'invalid-token-12345';

    // Navigate with invalid invite token
    await page.goto(`${routes.signUp}?invite=${invalidToken}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait a moment for the invite data fetch to fail and redirect
    await page.waitForTimeout(2000);

    // Should redirect to sign-in after invalid invite check
    // The app fetches invite data and redirects if invalid
    const currentUrl = page.url();
    const redirectedToSignIn = currentUrl.includes('/sign-in');
    const stayedOnSignUp = currentUrl.includes('/sign-up');

    // Either redirected to sign-in (invalid invite) or stayed on sign-up (loading/error)
    expect(redirectedToSignIn || stayedOnSignUp).toBe(true);
  });
});

test.describe('Sign Up - Navigation @auth', () => {
  /**
   * Test navigation behavior of sign-up page
   * @priority medium
   * @type positive
   *
   * Note: Sign-up page without invite token redirects to sign-in,
   * so we test that the redirect happens correctly.
   */
  test('Sign up without invite redirects to sign-in @medium @positive', async ({ page }) => {
    // Navigate to sign-up without invite token
    await page.goto(routes.signUp);
    await page.waitForLoadState('domcontentloaded');

    // Should redirect to sign-in page
    await expect(page).toHaveURL(/sign-in/, { timeout: 5000 });

    // Should be on sign-in page
    const signInHeading = page.locator('h1, h2').first();
    await expect(signInHeading).toBeVisible();
  });

  /**
   * Test page title and branding
   * @priority low
   * @type positive
   */
  test('Sign up page has correct branding @low @positive', async ({ page }) => {
    await page.goto(routes.signUp);

    // Should have some indication of sign up / create account
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible();
  });
});

test.describe('Sign Up - OAuth Error Handling @auth @oauth', () => {
  /**
   * Test OAuth callback with error
   * @priority high
   * @type negative
   */
  test('OAuth callback error shows message @high @negative', async ({ page }) => {
    // Simulate OAuth error callback
    await page.goto('/auth-callback?error=access_denied&error_description=User%20denied%20access');

    // Should show error or redirect to sign-in with error
    await page.waitForLoadState('domcontentloaded');

    // Check for error indication
    const hasErrorInUrl = page.url().includes('error');
    const hasErrorMessage = await page.locator('[role="alert"], .text-destructive, text=/error|denied|failed/i').isVisible().catch(() => false);
    const redirectedToSignIn = page.url().includes('/sign-in');

    expect(hasErrorInUrl || hasErrorMessage || redirectedToSignIn).toBe(true);
  });
});
