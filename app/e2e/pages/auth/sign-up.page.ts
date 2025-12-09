import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { routes } from '../../utils/env';

/**
 * Page Object for the Sign Up page (/sign-up)
 *
 * Handles all interactions with the signup form including:
 * - OAuth signup (GitHub, Google) - primary flow for non-invite
 * - Email/password signup - only available with invite token
 * - Invitation flow with pre-filled email
 */
export class SignUpPage extends BasePage {
  // Form elements (visible only with invite token)
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  // OAuth buttons (primary signup method)
  readonly githubButton: Locator;
  readonly googleButton: Locator;

  // Invitation elements
  readonly invitationBadge: Locator;
  readonly invitedEmailDisplay: Locator;

  // Links
  readonly signInLink: Locator;

  constructor(page: Page) {
    super(page);

    // Form elements - only visible with invite token
    this.nameInput = page
      .locator('[data-testid="signup-name-input"]')
      .or(page.locator('#name'))
      .or(page.locator('input[name="name"]'));

    this.emailInput = page
      .locator('[data-testid="signup-email-input"]')
      .or(page.locator('#email'))
      .or(page.locator('input[name="email"]'));

    this.passwordInput = page
      .locator('[data-testid="signup-password-input"]')
      .or(page.locator('#password'))
      .or(page.locator('input[name="password"]'));

    this.submitButton = page
      .locator('[data-testid="signup-submit-button"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Sign up")'))
      .or(page.locator('button:has-text("Create account")'));

    this.errorMessage = page
      .locator('[data-testid="signup-error-message"]')
      .or(page.locator('p.text-destructive'))
      .or(page.locator('[role="alert"]:not(#__next-route-announcer__)'));

    // OAuth buttons - primary signup method
    this.githubButton = page
      .locator('[data-testid="social-auth-github"]')
      .or(page.locator('[data-testid="signup-github-button"]'))
      .or(page.locator('button:has-text("GitHub")'));

    this.googleButton = page
      .locator('[data-testid="social-auth-google"]')
      .or(page.locator('[data-testid="signup-google-button"]'))
      .or(page.locator('button:has-text("Google")'));

    // Invitation elements
    this.invitationBadge = page
      .locator('[data-testid="invitation-badge"]')
      .or(page.locator('text=Invited'));

    this.invitedEmailDisplay = page
      .locator('[data-testid="invited-email"]')
      .or(page.locator('[data-invited-email]'));

    // Links
    this.signInLink = page
      .locator('[data-testid="signup-signin-link"]')
      .or(page.locator('a:has-text("Sign in")'))
      .or(page.locator('a[href*="sign-in"]'));
  }

  /**
   * Navigate to the sign-up page
   * @param inviteToken - Optional invite token for email signup flow
   */
  async navigate(inviteToken?: string): Promise<void> {
    const url = inviteToken ? `${routes.signUp}?invite=${inviteToken}` : routes.signUp;
    await this.goto(url);
    await this.waitForPageLoad();
  }

  /**
   * Sign up with email and password (requires invite token)
   * @param name - User's full name
   * @param email - User email (may be pre-filled if invited)
   * @param password - User password
   */
  async signUpWithEmail(name: string, email: string, password: string): Promise<void> {
    await this.nameInput.fill(name);
    // Email might be read-only if invited
    if (await this.emailInput.isEditable()) {
      await this.emailInput.fill(email);
    }
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /**
   * Sign up using only name and password (when email is pre-filled via invite)
   * @param name - User's full name
   * @param password - User password
   */
  async signUpWithInvite(name: string, password: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  /**
   * Click GitHub OAuth button for signup
   */
  async clickGitHubSignUp(): Promise<void> {
    await this.githubButton.click();
  }

  /**
   * Click Google OAuth button for signup
   */
  async clickGoogleSignUp(): Promise<void> {
    await this.googleButton.click();
  }

  /**
   * Click sign in link
   */
  async clickSignIn(): Promise<void> {
    await this.signInLink.click();
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
   * Assert that the page shows OAuth-only signup (no email form)
   */
  async expectOAuthOnlyMode(): Promise<void> {
    // OAuth buttons should be visible
    await expect(this.githubButton).toBeVisible();
    await expect(this.googleButton).toBeVisible();

    // Email form should be hidden (no name/email/password inputs visible)
    await expect(this.nameInput).toBeHidden();
    await expect(this.passwordInput).toBeHidden();
  }

  /**
   * Assert that the page shows email signup form (invite mode)
   */
  async expectEmailFormMode(): Promise<void> {
    await expect(this.nameInput).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  /**
   * Assert that the invitation badge is shown
   */
  async expectInvitationBadge(): Promise<void> {
    await expect(this.invitationBadge).toBeVisible();
  }

  /**
   * Assert that the email field is pre-filled and read-only (for invites)
   * @param expectedEmail - The expected email address
   */
  async expectInvitedEmail(expectedEmail: string): Promise<void> {
    await expect(this.emailInput).toHaveValue(expectedEmail);
    // Check if it's disabled or readonly
    const isDisabled = await this.emailInput.isDisabled();
    const isReadonly = (await this.emailInput.getAttribute('readonly')) !== null;
    expect(isDisabled || isReadonly).toBe(true);
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
   * Check if email form is visible (invite mode)
   */
  async isEmailFormVisible(): Promise<boolean> {
    return this.nameInput.isVisible();
  }

  /**
   * Fill name field
   * @param name - Name to fill
   */
  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
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
    if (await this.nameInput.isVisible()) {
      await this.nameInput.clear();
    }
    if ((await this.emailInput.isVisible()) && (await this.emailInput.isEditable())) {
      await this.emailInput.clear();
    }
    if (await this.passwordInput.isVisible()) {
      await this.passwordInput.clear();
    }
  }
}
