/**
 * Alerts Page Object Model
 *
 * Page objects for the Alerts and Notifications features including:
 * - Alert listing
 * - Alert configuration
 * - Notification channels
 * - Alert history
 */

import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Alerts Page
 * View and manage alert configurations
 */
export class AlertsPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Create alert button */
  readonly createButton: Locator;

  /** Alert list/table */
  readonly alertTable: Locator;

  /** Alert rows */
  readonly alertRows: Locator;

  /** Empty state */
  readonly emptyState: Locator;

  /** Search input */
  readonly searchInput: Locator;

  /** Status filter */
  readonly statusFilter: Locator;

  /** Type filter */
  readonly typeFilter: Locator;

  /** Delete dialog */
  readonly deleteDialog: Locator;

  /** Delete confirm button */
  readonly deleteConfirmButton: Locator;

  /** Delete cancel button */
  readonly deleteCancelButton: Locator;

  /** Row actions menu */
  readonly rowActionsMenu: Locator;

  /** Edit action */
  readonly editAction: Locator;

  /** Delete action */
  readonly deleteAction: Locator;

  constructor(page: Page) {
    super(page, '/alerts');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="alerts-title"]'))
      .or(page.locator('text=/alerts/i'));

    this.createButton = page
      .locator('[data-testid="create-alert-button"]')
      .or(page.locator('button:has-text("Create Alert")'))
      .or(page.locator('button:has-text("New Alert")'))
      .or(page.locator('a:has-text("Create Alert")'));

    this.alertTable = page
      .locator('[data-testid="alerts-table"]')
      .or(page.locator('table'))
      .or(page.locator('[role="table"]'));

    this.alertRows = page
      .locator('[data-testid="alert-row"]')
      .or(page.locator('table tbody tr'))
      .or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator('text=/no alerts/i'))
      .or(page.locator('.empty-state'));

    this.searchInput = page
      .locator('[data-testid="search-input"]')
      .or(page.locator('input[placeholder*="Search"]'))
      .or(page.locator('input[type="search"]'));

    this.statusFilter = page
      .locator('[data-testid="status-filter"]')
      .or(page.locator('button:has-text("Status")'));

    this.typeFilter = page
      .locator('[data-testid="type-filter"]')
      .or(page.locator('button:has-text("Type")'));

    this.deleteDialog = page
      .locator('[data-testid="delete-dialog"]')
      .or(page.locator('[role="alertdialog"]'))
      .or(page.locator('[role="dialog"]:has-text("Delete")'));

    this.deleteConfirmButton = page
      .locator('[data-testid="delete-confirm"]')
      .or(page.locator('button:has-text("Delete")').last())
      .or(page.locator('[role="dialog"] button:has-text("Delete")'));

    this.deleteCancelButton = page
      .locator('[data-testid="delete-cancel"]')
      .or(page.locator('button:has-text("Cancel")'));

    this.rowActionsMenu = page
      .locator('[data-testid="row-actions"]')
      .or(page.locator('button[aria-haspopup="menu"]'))
      .or(page.locator('button:has-text("Open menu")'));

    this.editAction = page
      .locator('[data-testid="edit-action"]')
      .or(page.locator('[role="menuitem"]:has-text("Edit")'));

    this.deleteAction = page
      .locator('[data-testid="delete-action"]')
      .or(page.locator('[role="menuitem"]:has-text("Delete")'));
  }

  /**
   * Navigate to the alerts page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/alerts');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/alerts/);
  }

  /**
   * Expect the create button to be visible
   */
  async expectCreateButtonVisible(): Promise<void> {
    await this.createButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Click create alert button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Get the number of alerts in the table
   */
  async getAlertCount(): Promise<number> {
    const count = await this.alertRows.count();
    return count;
  }

  /**
   * Check if table is visible
   */
  async isTableVisible(): Promise<boolean> {
    return this.alertTable.isVisible().catch(() => false);
  }

  /**
   * Check if empty state is visible
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return this.emptyState.isVisible().catch(() => false);
  }

  /**
   * Open row actions menu
   */
  async openRowActions(rowIndex: number): Promise<void> {
    const row = this.alertRows.nth(rowIndex);
    const actionsButton = row.locator('button[aria-haspopup="menu"]').or(row.locator('button:has-text("Open menu")'));
    await actionsButton.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Click a row
   */
  async clickRow(rowIndex: number): Promise<void> {
    await this.alertRows.nth(rowIndex).click();
    await this.page.waitForTimeout(500);
  }
}

/**
 * Alert Create/Edit Page
 * Configure alert settings
 */
export class AlertCreatePage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Alert name input */
  readonly nameInput: Locator;

  /** Alert condition selector */
  readonly conditionSelector: Locator;

  /** Threshold input */
  readonly thresholdInput: Locator;

  /** Channel selector */
  readonly channelSelector: Locator;

  /** Email channel option */
  readonly emailChannelOption: Locator;

  /** Slack channel option */
  readonly slackChannelOption: Locator;

  /** Discord channel option */
  readonly discordChannelOption: Locator;

  /** Webhook channel option */
  readonly webhookChannelOption: Locator;

  /** Save button */
  readonly saveButton: Locator;

  /** Cancel button */
  readonly cancelButton: Locator;

  /** Test alert button */
  readonly testAlertButton: Locator;

  constructor(page: Page) {
    super(page, '/alerts/create');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="alert-create-title"]'));

    this.nameInput = page
      .locator('[data-testid="alert-name-input"]')
      .or(page.locator('input[name="name"]'))
      .or(page.locator('input[placeholder*="Name"]'));

    this.conditionSelector = page
      .locator('[data-testid="condition-selector"]')
      .or(page.locator('select[name="condition"]'))
      .or(page.locator('[role="combobox"]:has-text("Condition")'));

    this.thresholdInput = page
      .locator('[data-testid="threshold-input"]')
      .or(page.locator('input[name="threshold"]'))
      .or(page.locator('input[type="number"]'));

    this.channelSelector = page
      .locator('[data-testid="channel-selector"]')
      .or(page.locator('[role="listbox"]'))
      .or(page.locator('.channel-selector'));

    this.emailChannelOption = page
      .locator('[data-testid="email-channel"]')
      .or(page.locator('button:has-text("Email")'))
      .or(page.locator('text=/email/i'));

    this.slackChannelOption = page
      .locator('[data-testid="slack-channel"]')
      .or(page.locator('button:has-text("Slack")'))
      .or(page.locator('text=/slack/i'));

    this.discordChannelOption = page
      .locator('[data-testid="discord-channel"]')
      .or(page.locator('button:has-text("Discord")'));

    this.webhookChannelOption = page
      .locator('[data-testid="webhook-channel"]')
      .or(page.locator('button:has-text("Webhook")'));

    this.saveButton = page
      .locator('[data-testid="save-alert-button"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Save")'));

    this.cancelButton = page
      .locator('[data-testid="cancel-button"]')
      .or(page.locator('button:has-text("Cancel")'));

    this.testAlertButton = page
      .locator('[data-testid="test-alert-button"]')
      .or(page.locator('button:has-text("Test")'));
  }

  /**
   * Navigate to the alert create page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/alerts/create');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  /**
   * Expect the page to be loaded
   */
  async expectLoaded(): Promise<void> {
    await this.page.waitForURL(/alerts/);
  }

  /**
   * Fill in the alert name
   */
  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
  }

  /**
   * Click save button
   */
  async save(): Promise<void> {
    await this.saveButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Click cancel button
   */
  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if save button is visible
   */
  async isSaveButtonVisible(): Promise<boolean> {
    return this.saveButton.isVisible().catch(() => false);
  }
}

/**
 * Notification Channels Page
 * Manage notification channels (Email, Slack, Discord, etc.)
 */
export class NotificationChannelsPage extends BasePage {
  /** Page title */
  readonly pageTitle: Locator;

  /** Add channel button */
  readonly addChannelButton: Locator;

  /** Channel cards */
  readonly channelCards: Locator;

  /** Email channels */
  readonly emailChannels: Locator;

  /** Slack channels */
  readonly slackChannels: Locator;

  /** Discord channels */
  readonly discordChannels: Locator;

  /** Webhook channels */
  readonly webhookChannels: Locator;

  /** Empty state */
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page, '/settings/notifications');

    this.pageTitle = page
      .locator('h1')
      .or(page.locator('[data-testid="channels-title"]'));

    this.addChannelButton = page
      .locator('[data-testid="add-channel-button"]')
      .or(page.locator('button:has-text("Add Channel")'))
      .or(page.locator('button:has-text("Add")'));

    this.channelCards = page
      .locator('[data-testid="channel-card"]')
      .or(page.locator('.channel-card'))
      .or(page.locator('[data-radix-collection-item]'));

    this.emailChannels = page
      .locator('[data-testid="email-channel"]')
      .or(page.locator('.email-channel'));

    this.slackChannels = page
      .locator('[data-testid="slack-channel"]')
      .or(page.locator('.slack-channel'));

    this.discordChannels = page
      .locator('[data-testid="discord-channel"]')
      .or(page.locator('.discord-channel'));

    this.webhookChannels = page
      .locator('[data-testid="webhook-channel"]')
      .or(page.locator('.webhook-channel'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator('text=/no channels/i'));
  }

  /**
   * Navigate to the notification channels page
   */
  async navigate(): Promise<void> {
    await this.page.goto('/settings/notifications');
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
   * Get the count of configured channels
   */
  async getChannelCount(): Promise<number> {
    return this.channelCards.count();
  }

  /**
   * Check if add channel button is visible
   */
  async isAddChannelButtonVisible(): Promise<boolean> {
    return this.addChannelButton.isVisible().catch(() => false);
  }

  /**
   * Click add channel button
   */
  async clickAddChannel(): Promise<void> {
    await this.addChannelButton.click();
    await this.page.waitForTimeout(500);
  }
}
