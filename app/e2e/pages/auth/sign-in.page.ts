import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { routes } from '../../utils/env';

/**
 * Page Object for the Sign In page (/sign-in)
 *
 * Handles all interactions with the login form including:
 * - Email/password authentication
 * - OAuth providers (GitHub, Google)
 * - Error handling
 * - "Last used" badge display
 */
export class SignInPage extends BasePage {
  // Form elements
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  // OAuth buttons
  readonly githubButton: Locator;
  readonly googleButton: Locator;

  // Links
  readonly forgotPasswordLink: Locator;
  readonly signUpLink: Locator;

  // Status indicators
  readonly emailVerifiedAlert: Locator;
  readonly lastUsedBadge: Locator;

  constructor(page: Page) {
    super(page);

    // Form elements - using multiple selector strategies for robustness
    this.emailInput = page
      .locator('[data-testid="login-email-input"]')
      .or(page.locator('#email'))
      .or(page.locator('input[name="email"]'));

    this.passwordInput = page
      .locator('[data-testid="login-password-input"]')
      .or(page.locator('#password'))
      .or(page.locator('input[name="password"]'));

    this.submitButton = page
      .locator('[data-testid="login-submit-button"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Login")'))
      .or(page.locator('button:has-text("Sign in")'));

    this.errorMessage = page
      .locator('[data-testid="login-error-message"]')
      .or(page.locator('p.text-destructive'))
      .or(page.locator('[role="alert"]:not(#__next-route-announcer__)'));

    // OAuth buttons
    this.githubButton = page
      .locator('[data-testid="login-github-button"]')
      .or(page.locator('button:has-text("GitHub")'))
      .or(page.locator('button:has-text("Continue with GitHub")'));

    this.googleButton = page
      .locator('[data-testid="login-google-button"]')
      .or(page.locator('button:has-text("Google")'))
      .or(page.locator('button:has-text("Continue with Google")'));

    // Links
    this.forgotPasswordLink = page
      .locator('[data-testid="login-forgot-password-link"]')
      .or(page.locator('a:has-text("Forgot")'))
      .or(page.locator('a[href*="forgot-password"]'));

    this.signUpLink = page
      .locator('[data-testid="login-signup-link"]')
      .or(page.locator('a:has-text("Sign up")'))
      .or(page.locator('a[href*="sign-up"]'));

    // Status indicators
    this.emailVerifiedAlert = page
      .locator('[data-testid="email-verified-alert"]')
      .or(page.locator('text=Email verified'));

    this.lastUsedBadge = page
      .locator('[data-testid="last-used-badge"]')
      .or(page.locator('text=Last used'));
  }

  /**
   * Navigate to the sign-in page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.signIn);
    await this.waitForPageLoad();
  }

  /**
   * Sign in with email and password
   * @param email - User email
   * @param password - User password
   */
  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await this.waitForPageLoad();
  }

  /**
   * Sign in and wait for redirect to dashboard
   * @param email - User email
   * @param password - User password
   */
  async signInAndWaitForDashboard(email: string, password: string): Promise<void> {
    await this.signIn(email, password);
    await this.waitForNavigation('/');
    await this.waitForPageLoad();
  }

  /**
   * Click GitHub OAuth button
   */
  async clickGitHubLogin(): Promise<void> {
    await this.githubButton.click();
  }

  /**
   * Click Google OAuth button
   */
  async clickGoogleLogin(): Promise<void> {
    await this.googleButton.click();
  }

  /**
   * Click forgot password link
   */
  async clickForgotPassword(): Promise<void> {
    await this.forgotPasswordLink.click();
    await this.waitForNavigation(routes.forgotPassword);
  }

  /**
   * Click sign up link
   */
  async clickSignUp(): Promise<void> {
    await this.signUpLink.click();
    await this.waitForNavigation(routes.signUp);
  }

  /**
   * Get the error message text
   * @returns Error message text or null
   */
  async getErrorMessage(): Promise<string | null> {
    if (await this.errorMessage.isVisible()) {
      return this.errorMessage.textContent();
    }
    return null;
  }

  /**
   * Assert that an error message is displayed
   * @param expectedMessage - Expected error message (optional)
   */
  async expectError(expectedMessage?: string | RegExp): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    if (expectedMessage) {
      await expect(this.errorMessage).toContainText(expectedMessage);
    }
  }

  /**
   * Assert that no error is displayed
   */
  async expectNoError(): Promise<void> {
    await expect(this.errorMessage).toBeHidden();
  }

  /**
   * Assert that the email verified alert is shown
   */
  async expectEmailVerifiedAlert(): Promise<void> {
    await expect(this.emailVerifiedAlert).toBeVisible();
  }

  /**
   * Assert that the "Last used" badge is shown on a button
   * @param provider - The OAuth provider ('github' or 'google')
   */
  async expectLastUsedBadge(provider: 'github' | 'google'): Promise<void> {
    const button = provider === 'github' ? this.githubButton : this.googleButton;
    const badge = button.locator('[data-testid="last-used-badge"]').or(button.locator('text=Last used'));
    await expect(badge).toBeVisible();
  }

  /**
   * Assert that the form is in its initial state
   */
  async expectInitialState(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
    await expect(this.submitButton).toBeEnabled();
    await this.expectNoError();
  }

  /**
   * Assert that the submit button is disabled (during loading)
   */
  async expectLoading(): Promise<void> {
    await expect(this.submitButton).toBeDisabled();
  }

  /**
   * Check if GitHub OAuth is available
   */
  async isGitHubAvailable(): Promise<boolean> {
    return this.githubButton.isVisible();
  }

  /**
   * Check if Google OAuth is available
   */
  async isGoogleAvailable(): Promise<boolean> {
    return this.googleButton.isVisible();
  }

  /**
   * Fill email field
   * @param email - Email to fill
   */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  /**
   * Fill password field
   * @param password - Password to fill
   */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  /**
   * Submit the form
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * Clear form fields
   */
  async clearForm(): Promise<void> {
    await this.emailInput.clear();
    await this.passwordInput.clear();
  }
}
