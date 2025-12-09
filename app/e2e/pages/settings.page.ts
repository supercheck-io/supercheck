/**
 * Settings Page Object Model
 *
 * Page objects for the Settings pages including:
 * - General settings
 * - Organization settings
 * - Project settings
 * - API keys
 * - Variables/Secrets
 * - Billing
 */

import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * General Settings Page
 */
export class SettingsPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Settings navigation sidebar */
  readonly settingsNav: Locator;

  /** Profile link */
  readonly profileLink: Locator;

  /** Security link */
  readonly securityLink: Locator;

  /** Notifications link */
  readonly notificationsLink: Locator;

  /** API Keys link */
  readonly apiKeysLink: Locator;

  /** Save button */
  readonly saveButton: Locator;

  /** Success toast/message */
  readonly successMessage: Locator;

  /** Error toast/message */
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page, '/settings');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="settings-title"]'));

    this.settingsNav = page
      .locator('[data-testid="settings-nav"]')
      .or(page.locator('nav[aria-label="Settings"]'))
      .or(page.locator('.settings-nav'));

    this.profileLink = page
      .locator('a[href*="profile"]')
      .or(page.locator('button:has-text("Profile")'));

    this.securityLink = page
      .locator('a[href*="security"]')
      .or(page.locator('button:has-text("Security")'));

    this.notificationsLink = page
      .locator('a[href*="notifications"]')
      .or(page.locator('button:has-text("Notifications")'));

    this.apiKeysLink = page
      .locator('a[href*="api-keys"]')
      .or(page.locator('button:has-text("API Keys")'));

    this.saveButton = page
      .locator('[data-testid="save-settings-button"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Save")'));

    this.successMessage = page
      .locator('[data-testid="success-message"]')
      .or(page.locator('[role="status"]'))
      .or(page.locator('.toast-success'));

    this.errorMessage = page
      .locator('[data-testid="error-message"]')
      .or(page.locator('[role="alert"]'))
      .or(page.locator('.toast-error'));
  }

  /**
   * Navigate to settings page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/settings');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/settings/);
  }

  /**
   * Navigate to profile settings
   */
  async goToProfile(): Promise<void> {
    await this.profileLink.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Navigate to security settings
   */
  async goToSecurity(): Promise<void> {
    await this.securityLink.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Navigate to API Keys settings
   */
  async goToApiKeys(): Promise<void> {
    await this.apiKeysLink.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Save settings
   */
  async save(): Promise<void> {
    await this.saveButton.click();
    await this.page.waitForTimeout(500);
  }
}

/**
 * API Keys Page
 * Manage API keys for programmatic access
 */
export class ApiKeysPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Create API key button */
  readonly createButton: Locator;

  /** API keys table */
  readonly keysTable: Locator;

  /** API key rows */
  readonly keyRows: Locator;

  /** Empty state */
  readonly emptyState: Locator;

  /** Create dialog */
  readonly createDialog: Locator;

  /** Key name input */
  readonly nameInput: Locator;

  /** Scope checkboxes */
  readonly scopeCheckboxes: Locator;

  /** Read scope checkbox */
  readonly readScope: Locator;

  /** Write scope checkbox */
  readonly writeScope: Locator;

  /** Create dialog submit button */
  readonly dialogSubmitButton: Locator;

  /** Create dialog cancel button */
  readonly dialogCancelButton: Locator;

  /** Revoke button */
  readonly revokeButton: Locator;

  /** Copy key button */
  readonly copyKeyButton: Locator;

  /** New key display */
  readonly newKeyDisplay: Locator;

  constructor(page: Page) {
    super(page, '/settings/api-keys');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="api-keys-title"]'));

    this.createButton = page
      .locator('[data-testid="create-api-key-button"]')
      .or(page.locator('button:has-text("Create API Key")'))
      .or(page.locator('button:has-text("New Key")'));

    this.keysTable = page
      .locator('[data-testid="api-keys-table"]')
      .or(page.locator('table'))
      .or(page.locator('[role="table"]'));

    this.keyRows = page
      .locator('[data-testid="api-key-row"]')
      .or(page.locator('table tbody tr'))
      .or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator('text=/no api keys/i'));

    this.createDialog = page
      .locator('[data-testid="create-api-key-dialog"]')
      .or(page.locator('[role="dialog"]'));

    this.nameInput = page
      .locator('[data-testid="api-key-name-input"]')
      .or(page.locator('input[name="name"]'))
      .or(page.locator('[role="dialog"] input'));

    this.scopeCheckboxes = page
      .locator('[data-testid="scope-checkbox"]')
      .or(page.locator('input[type="checkbox"]'));

    this.readScope = page
      .locator('[data-testid="read-scope"]')
      .or(page.locator('input[value="read"]'));

    this.writeScope = page
      .locator('[data-testid="write-scope"]')
      .or(page.locator('input[value="write"]'));

    this.dialogSubmitButton = page
      .locator('[data-testid="create-api-key-submit"]')
      .or(page.locator('[role="dialog"] button[type="submit"]'))
      .or(page.locator('[role="dialog"] button:has-text("Create")'));

    this.dialogCancelButton = page
      .locator('[data-testid="create-api-key-cancel"]')
      .or(page.locator('[role="dialog"] button:has-text("Cancel")'));

    this.revokeButton = page
      .locator('[data-testid="revoke-api-key-button"]')
      .or(page.locator('button:has-text("Revoke")'));

    this.copyKeyButton = page
      .locator('[data-testid="copy-api-key-button"]')
      .or(page.locator('button:has-text("Copy")'));

    this.newKeyDisplay = page
      .locator('[data-testid="new-api-key-display"]')
      .or(page.locator('code'))
      .or(page.locator('.api-key-display'));
  }

  /**
   * Navigate to API Keys page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/settings/api-keys');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/api-keys/);
  }

  /**
   * Click create API key button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Wait for create dialog
   */
  async waitForCreateDialog(): Promise<void> {
    await this.createDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Fill API key name
   */
  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  /**
   * Submit create dialog
   */
  async submitCreateDialog(): Promise<void> {
    await this.dialogSubmitButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Cancel create dialog
   */
  async cancelCreateDialog(): Promise<void> {
    await this.dialogCancelButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Get count of API keys
   */
  async getKeyCount(): Promise<number> {
    return this.keyRows.count();
  }

  /**
   * Check if create button is visible
   */
  async isCreateButtonVisible(): Promise<boolean> {
    return this.createButton.isVisible().catch(() => false);
  }
}

/**
 * Variables Page
 * Manage environment variables and secrets
 */
export class VariablesPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Create variable button */
  readonly createButton: Locator;

  /** Variables table */
  readonly variablesTable: Locator;

  /** Variable rows */
  readonly variableRows: Locator;

  /** Empty state */
  readonly emptyState: Locator;

  /** Create dialog */
  readonly createDialog: Locator;

  /** Variable name input */
  readonly nameInput: Locator;

  /** Variable value input */
  readonly valueInput: Locator;

  /** Is secret checkbox */
  readonly isSecretCheckbox: Locator;

  /** Dialog submit button */
  readonly dialogSubmitButton: Locator;

  /** Dialog cancel button */
  readonly dialogCancelButton: Locator;

  /** Edit button */
  readonly editButton: Locator;

  /** Delete button */
  readonly deleteButton: Locator;

  constructor(page: Page) {
    super(page, '/variables');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="variables-title"]'));

    this.createButton = page
      .locator('[data-testid="create-variable-button"]')
      .or(page.locator('button:has-text("Create Variable")'))
      .or(page.locator('button:has-text("Add Variable")'));

    this.variablesTable = page
      .locator('[data-testid="variables-table"]')
      .or(page.locator('table'))
      .or(page.locator('[role="table"]'));

    this.variableRows = page
      .locator('[data-testid="variable-row"]')
      .or(page.locator('table tbody tr'))
      .or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator('text=/no variables/i'));

    this.createDialog = page
      .locator('[data-testid="create-variable-dialog"]')
      .or(page.locator('[role="dialog"]'));

    this.nameInput = page
      .locator('[data-testid="variable-name-input"]')
      .or(page.locator('input[name="name"]'))
      .or(page.locator('input[placeholder*="Name"]'));

    this.valueInput = page
      .locator('[data-testid="variable-value-input"]')
      .or(page.locator('input[name="value"]'))
      .or(page.locator('textarea[name="value"]'));

    this.isSecretCheckbox = page
      .locator('[data-testid="is-secret-checkbox"]')
      .or(page.locator('input[name="isSecret"]'));

    this.dialogSubmitButton = page
      .locator('[data-testid="create-variable-submit"]')
      .or(page.locator('[role="dialog"] button[type="submit"]'))
      .or(page.locator('[role="dialog"] button:has-text("Create")'));

    this.dialogCancelButton = page
      .locator('[data-testid="create-variable-cancel"]')
      .or(page.locator('[role="dialog"] button:has-text("Cancel")'));

    this.editButton = page
      .locator('[data-testid="edit-variable-button"]')
      .or(page.locator('button:has-text("Edit")'));

    this.deleteButton = page
      .locator('[data-testid="delete-variable-button"]')
      .or(page.locator('button:has-text("Delete")'));
  }

  /**
   * Navigate to Variables page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/variables');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/variables/);
  }

  /**
   * Click create variable button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Wait for create dialog
   */
  async waitForCreateDialog(): Promise<void> {
    await this.createDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Fill variable name
   */
  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  /**
   * Fill variable value
   */
  async fillValue(value: string): Promise<void> {
    await this.valueInput.fill(value);
  }

  /**
   * Submit create dialog
   */
  async submitCreateDialog(): Promise<void> {
    await this.dialogSubmitButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Get count of variables
   */
  async getVariableCount(): Promise<number> {
    return this.variableRows.count();
  }

  /**
   * Check if create button is visible
   */
  async isCreateButtonVisible(): Promise<boolean> {
    return this.createButton.isVisible().catch(() => false);
  }
}

/**
 * Billing Page
 * Manage subscription and billing
 */
export class BillingPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Current plan display */
  readonly currentPlan: Locator;

  /** Upgrade button */
  readonly upgradeButton: Locator;

  /** Manage subscription button */
  readonly manageSubscriptionButton: Locator;

  /** Usage display */
  readonly usageDisplay: Locator;

  /** Invoice history */
  readonly invoiceHistory: Locator;

  /** Payment method display */
  readonly paymentMethod: Locator;

  constructor(page: Page) {
    super(page, '/billing');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="billing-title"]'));

    this.currentPlan = page
      .locator('[data-testid="current-plan"]')
      .or(page.locator('.current-plan'))
      .or(page.locator('text=/plan/i'));

    this.upgradeButton = page
      .locator('[data-testid="upgrade-button"]')
      .or(page.locator('button:has-text("Upgrade")'))
      .or(page.locator('a:has-text("Upgrade")'));

    this.manageSubscriptionButton = page
      .locator('[data-testid="manage-subscription-button"]')
      .or(page.locator('button:has-text("Manage Subscription")'))
      .or(page.locator('a:has-text("Manage")'));

    this.usageDisplay = page
      .locator('[data-testid="usage-display"]')
      .or(page.locator('.usage-display'));

    this.invoiceHistory = page
      .locator('[data-testid="invoice-history"]')
      .or(page.locator('.invoice-history'));

    this.paymentMethod = page
      .locator('[data-testid="payment-method"]')
      .or(page.locator('.payment-method'));
  }

  /**
   * Navigate to Billing page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/billing');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/billing/);
  }

  /**
   * Check if current plan is visible
   */
  async isCurrentPlanVisible(): Promise<boolean> {
    return this.currentPlan.isVisible().catch(() => false);
  }

  /**
   * Check if upgrade button is visible
   */
  async isUpgradeButtonVisible(): Promise<boolean> {
    return this.upgradeButton.isVisible().catch(() => false);
  }

  /**
   * Click upgrade button
   */
  async clickUpgrade(): Promise<void> {
    await this.upgradeButton.click();
    await this.page.waitForTimeout(500);
  }
}
