import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { routes } from '../../utils/env';

/**
 * Page Object for the Forgot Password page (/forgot-password)
 *
 * Handles interactions with the password reset request form including:
 * - Submitting email for password reset
 * - Success and error states
 * - Rate limiting feedback
 */
export class ForgotPasswordPage extends BasePage {
  // Form elements
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly successMessage: Locator;

  // Links
  readonly backToSignInLink: Locator;

  // Rate limiting
  readonly rateLimitMessage: Locator;

  constructor(page: Page) {
    super(page);

    // Form elements
    this.emailInput = page
      .locator('[data-testid="forgot-password-email-input"]')
      .or(page.locator('#email'))
      .or(page.locator('input[name="email"]'));

    this.submitButton = page
      .locator('[data-testid="forgot-password-submit"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Send")'))
      .or(page.locator('button:has-text("Reset")'));

    this.errorMessage = page
      .locator('[data-testid="forgot-password-error"]')
      .or(page.locator('[role="alert"]'))
      .or(page.locator('.text-destructive'));

    this.successMessage = page
      .locator('[data-testid="forgot-password-success"]')
      .or(page.locator('text=/check your email/i'))
      .or(page.locator('text=/email sent/i'))
      .or(page.locator('text=/reset link/i'));

    // Links
    this.backToSignInLink = page
      .locator('[data-testid="back-to-signin-link"]')
      .or(page.locator('a:has-text("Sign in")'))
      .or(page.locator('a:has-text("Back")'))
      .or(page.locator('a[href*="sign-in"]'));

    // Rate limiting
    this.rateLimitMessage = page
      .locator('[data-testid="rate-limit-message"]')
      .or(page.locator('text=too many requests'))
      .or(page.locator('text=please wait'));
  }

  /**
   * Navigate to the forgot password page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.forgotPassword);
    await this.waitForPageLoad();
  }

  /**
   * Submit email for password reset
   * @param email - Email address to send reset link
   */
  async requestReset(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  }

  /**
   * Submit form and wait for success message
   * @param email - Email address to send reset link
   */
  async requestResetAndWaitForSuccess(email: string): Promise<void> {
    await this.requestReset(email);
    await this.expectSuccess();
  }

  /**
   * Click back to sign in link
   */
  async clickBackToSignIn(): Promise<void> {
    await this.backToSignInLink.click();
    await this.waitForNavigation(routes.signIn);
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
   * Assert that success message is displayed
   * @param expectedMessage - Expected success message (optional)
   */
  async expectSuccess(expectedMessage?: string | RegExp): Promise<void> {
    await expect(this.successMessage).toBeVisible({ timeout: 10000 });
    if (expectedMessage) {
      await expect(this.successMessage).toContainText(expectedMessage);
    }
  }

  /**
   * Assert that rate limit message is displayed
   */
  async expectRateLimited(): Promise<void> {
    await expect(this.rateLimitMessage).toBeVisible();
  }

  /**
   * Assert that the form is in its initial state
   */
  async expectInitialState(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.emailInput).toBeEmpty();
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
   * Fill email field
   * @param email - Email to fill
   */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
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
  }
}
