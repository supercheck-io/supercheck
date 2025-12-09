import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { routes } from '../../utils/env';

/**
 * Page Object for the Invitation page (/invite/[token])
 *
 * Handles interactions with organization invitation acceptance:
 * - Viewing invitation details
 * - Accepting or declining invitations
 * - Handling expired/invalid invitations
 */
export class InvitePage extends BasePage {
  // Invitation details
  readonly organizationName: Locator;
  readonly roleBadge: Locator;
  readonly inviterName: Locator;
  readonly inviterEmail: Locator;
  readonly expiryWarning: Locator;

  // Action buttons
  readonly acceptButton: Locator;
  readonly declineButton: Locator;

  // Error states
  readonly errorMessage: Locator;
  readonly expiredMessage: Locator;
  readonly invalidMessage: Locator;

  // Loading state
  readonly loadingIndicator: Locator;

  constructor(page: Page) {
    super(page);

    // Invitation details
    this.organizationName = page
      .locator('[data-testid="invite-org-name"]')
      .or(page.locator('h1'))
      .or(page.locator('[data-org-name]'));

    this.roleBadge = page
      .locator('[data-testid="invite-role-badge"]')
      .or(page.locator('[data-role]'))
      .or(page.locator('.badge'));

    this.inviterName = page
      .locator('[data-testid="invite-inviter-name"]')
      .or(page.locator('[data-inviter-name]'));

    this.inviterEmail = page
      .locator('[data-testid="invite-inviter-email"]')
      .or(page.locator('[data-inviter-email]'));

    this.expiryWarning = page
      .locator('[data-testid="invite-expiry-warning"]')
      .or(page.locator('text=expires'))
      .or(page.locator('text=expiring'));

    // Action buttons
    this.acceptButton = page
      .locator('[data-testid="invite-accept-button"]')
      .or(page.locator('button:has-text("Accept")'))
      .or(page.locator('button:has-text("Join")'));

    this.declineButton = page
      .locator('[data-testid="invite-decline-button"]')
      .or(page.locator('button:has-text("Decline")'))
      .or(page.locator('button:has-text("Reject")'));

    // Error states
    this.errorMessage = page
      .locator('[data-testid="invite-error"]')
      .or(page.locator('[role="alert"]'));

    this.expiredMessage = page
      .locator('[data-testid="invite-expired"]')
      .or(page.locator('text=expired'))
      .or(page.locator('text=no longer valid'));

    this.invalidMessage = page
      .locator('[data-testid="invite-invalid"]')
      .or(page.locator('text=invalid'))
      .or(page.locator('text=not found'));

    // Loading state
    this.loadingIndicator = page
      .locator('[data-testid="invite-loading"]')
      .or(page.locator('.animate-spin'))
      .or(page.locator('[role="progressbar"]'));
  }

  /**
   * Navigate to an invitation page
   * @param token - The invitation token
   */
  async navigate(token: string): Promise<void> {
    await this.goto(routes.invite(token));
    await this.waitForPageLoad();
  }

  /**
   * Accept the invitation
   */
  async accept(): Promise<void> {
    await this.acceptButton.click();
  }

  /**
   * Accept invitation and wait for redirect to dashboard
   */
  async acceptAndWaitForDashboard(): Promise<void> {
    await this.accept();
    await this.waitForNavigation('/');
    await this.waitForPageLoad();
  }

  /**
   * Decline the invitation
   */
  async decline(): Promise<void> {
    await this.declineButton.click();
  }

  /**
   * Decline invitation and wait for redirect
   */
  async declineAndWaitForRedirect(): Promise<void> {
    await this.decline();
    // May redirect to sign-in or show confirmation
    await this.waitForNavigation(/\/(sign-in|declined)/);
  }

  /**
   * Get the organization name from the invitation
   * @returns Organization name
   */
  async getOrganizationName(): Promise<string | null> {
    return this.organizationName.textContent();
  }

  /**
   * Get the role from the invitation
   * @returns Role name
   */
  async getRole(): Promise<string | null> {
    return this.roleBadge.textContent();
  }

  /**
   * Get the inviter's name
   * @returns Inviter name
   */
  async getInviterName(): Promise<string | null> {
    if (await this.inviterName.isVisible()) {
      return this.inviterName.textContent();
    }
    return null;
  }

  /**
   * Assert that the invitation is valid and shows details
   */
  async expectValidInvitation(): Promise<void> {
    await expect(this.organizationName).toBeVisible();
    await expect(this.acceptButton).toBeVisible();
    await expect(this.declineButton).toBeVisible();
    await expect(this.expiredMessage).toBeHidden();
    await expect(this.invalidMessage).toBeHidden();
  }

  /**
   * Assert that the invitation details match expected values
   * @param orgName - Expected organization name
   * @param role - Expected role
   */
  async expectInvitationDetails(orgName: string, role: string): Promise<void> {
    await expect(this.organizationName).toContainText(orgName);
    await expect(this.roleBadge).toContainText(role);
  }

  /**
   * Assert that the invitation is expired
   */
  async expectExpired(): Promise<void> {
    await expect(this.expiredMessage).toBeVisible();
    await expect(this.acceptButton).toBeHidden();
  }

  /**
   * Assert that the invitation is invalid
   */
  async expectInvalid(): Promise<void> {
    await expect(this.invalidMessage).toBeVisible();
    await expect(this.acceptButton).toBeHidden();
  }

  /**
   * Assert that the expiry warning is shown
   */
  async expectExpiryWarning(): Promise<void> {
    await expect(this.expiryWarning).toBeVisible();
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
   * Assert that the page is loading
   */
  async expectLoading(): Promise<void> {
    await expect(this.loadingIndicator).toBeVisible();
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoadingComplete(): Promise<void> {
    await expect(this.loadingIndicator).toBeHidden({ timeout: 10000 });
  }

  /**
   * Check if accept button is enabled
   */
  async isAcceptEnabled(): Promise<boolean> {
    return this.acceptButton.isEnabled();
  }

  /**
   * Check if decline button is enabled
   */
  async isDeclineEnabled(): Promise<boolean> {
    return this.declineButton.isEnabled();
  }
}
