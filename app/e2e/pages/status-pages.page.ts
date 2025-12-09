import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";
import { routes } from "../utils/env";

/**
 * Page Object for the Status Pages list page (/status-pages)
 *
 * Handles interactions with the status pages list including:
 * - Viewing status page cards
 * - Creating status pages
 * - Managing status pages (edit, delete, view)
 * - Copy URL functionality
 */
export class StatusPagesPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly createButton: Locator;
  readonly emptyState: Locator;
  readonly emptyStateCreateButton: Locator;
  readonly statusPageCards: Locator;

  // Create dialog
  readonly createDialog: Locator;
  readonly nameInput: Locator;
  readonly headlineInput: Locator;
  readonly descriptionInput: Locator;
  readonly createDialogSubmit: Locator;
  readonly createDialogCancel: Locator;

  // Delete dialog
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Page elements
    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /status pages/i })
      .first();

    this.createButton = page
      .locator('[data-testid="create-status-page-button"]')
      .or(page.locator('button:has-text("Create Status Page")'))
      .first();

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator("text=/no status pages/i"))
      .or(page.locator("text=/create your first status page/i"));

    this.emptyStateCreateButton = page
      .locator('[data-testid="empty-state-create"]')
      .or(page.locator('button:has-text("Create Your First Status Page")'));

    this.statusPageCards = page
      .locator('[data-testid="status-page-card"]')
      .or(page.locator(".status-page-card"))
      .or(
        page
          .locator('[class*="Card"]')
          .filter({ has: page.locator("text=/manage|view/i") })
      );

    // Create dialog
    this.createDialog = page
      .locator('[role="dialog"]')
      .or(page.locator('[data-testid="create-status-page-dialog"]'));

    this.nameInput = this.createDialog
      .locator('input[name="name"]')
      .or(this.createDialog.locator("input").first());

    this.headlineInput = this.createDialog
      .locator('input[name="headline"]')
      .or(this.createDialog.locator("input").nth(1));

    this.descriptionInput = this.createDialog
      .locator('textarea[name="description"]')
      .or(this.createDialog.locator("textarea"));

    this.createDialogSubmit = this.createDialog
      .locator('button:has-text("Create Status Page")')
      .or(this.createDialog.locator('button[type="submit"]'));

    this.createDialogCancel = this.createDialog.locator(
      'button:has-text("Cancel")'
    );

    // Delete dialog
    this.deleteDialog = page
      .locator('[role="alertdialog"]')
      .or(page.locator('[data-testid="delete-dialog"]'));

    this.deleteConfirmButton = this.deleteDialog.locator(
      'button:has-text("Delete")'
    );
    this.deleteCancelButton = this.deleteDialog.locator(
      'button:has-text("Cancel")'
    );
  }

  /**
   * Navigate to the status pages list
   */
  async navigate(): Promise<void> {
    await this.goto(routes.statusPages);
    await this.waitForPageLoad();
  }

  /**
   * Click the create status page button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
  }

  /**
   * Wait for create dialog to appear
   */
  async waitForCreateDialog(): Promise<void> {
    await this.createDialog.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Fill the create status page form
   */
  async fillCreateForm(
    name: string,
    headline?: string,
    description?: string
  ): Promise<void> {
    await this.nameInput.fill(name);
    if (headline) {
      await this.headlineInput.fill(headline);
    }
    if (description) {
      await this.descriptionInput.fill(description);
    }
  }

  /**
   * Submit the create form
   */
  async submitCreateForm(): Promise<void> {
    await this.createDialogSubmit.click();
  }

  /**
   * Cancel the create dialog
   */
  async cancelCreateDialog(): Promise<void> {
    await this.createDialogCancel.click();
  }

  /**
   * Get the number of status page cards
   */
  async getStatusPageCount(): Promise<number> {
    await this.page.waitForTimeout(500);
    return this.statusPageCards.count();
  }

  /**
   * Check if empty state is visible
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return this.emptyState.isVisible();
  }

  /**
   * Click on a status page card
   * @param index - Card index (0-based)
   */
  async clickCard(index: number): Promise<void> {
    await this.statusPageCards.nth(index).click();
  }

  /**
   * Open card actions menu
   * @param index - Card index (0-based)
   */
  async openCardActions(index: number): Promise<void> {
    const card = this.statusPageCards.nth(index);
    const actionsButton = card.locator('button[aria-haspopup="menu"]').or(
      card
        .locator("button")
        .filter({ has: this.page.locator("svg") })
        .last()
    );
    await actionsButton.click();
  }

  /**
   * Click manage action on a card
   * @param index - Card index (0-based)
   */
  async clickManage(index: number): Promise<void> {
    const card = this.statusPageCards.nth(index);
    const manageButton = card
      .locator('a:has-text("Manage")')
      .or(card.locator('button:has-text("Manage")'));
    await manageButton.click();
  }

  /**
   * Click view action on a card
   * @param index - Card index (0-based)
   */
  async clickView(index: number): Promise<void> {
    const card = this.statusPageCards.nth(index);
    const viewButton = card
      .locator('a:has-text("View")')
      .or(card.locator('button:has-text("View")'));
    await viewButton.click();
  }

  /**
   * Copy URL of a status page
   * @param index - Card index (0-based)
   */
  async copyUrl(index: number): Promise<void> {
    const card = this.statusPageCards.nth(index);
    const copyButton = card
      .locator('button:has-text("Copy")')
      .or(card.locator('[aria-label="Copy URL"]'));
    await copyButton.click();
  }

  /**
   * Delete a status page from card actions
   * @param index - Card index (0-based)
   */
  async deleteStatusPage(index: number): Promise<void> {
    await this.openCardActions(index);
    await this.page.locator('[role="menuitem"]:has-text("Delete")').click();
    await this.deleteConfirmButton.click();
  }

  /**
   * Assert page has loaded successfully
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/status-pages/);
    // Wait for content to load
    await this.page.waitForTimeout(2000);
    const hasCards = await this.statusPageCards
      .first()
      .isVisible()
      .catch(() => false);
    const hasEmpty = await this.emptyState.isVisible().catch(() => false);
    const hasCreateButton = await this.createButton
      .isVisible()
      .catch(() => false);
    const hasTitle = await this.pageTitle.isVisible().catch(() => false);
    const hasMain = await this.page
      .locator("main")
      .isVisible()
      .catch(() => false);
    // Page is loaded if we have any of these elements
    expect(hasCards || hasEmpty || hasCreateButton || hasTitle || hasMain).toBe(
      true
    );
  }

  /**
   * Assert create button is visible
   */
  async expectCreateButtonVisible(): Promise<void> {
    // Try multiple selectors
    const createBtn = this.page
      .locator('[data-testid="create-status-page-button"]')
      .or(this.page.locator('button:has-text("Create")'))
      .or(this.page.locator('a:has-text("Create")'))
      .first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert create dialog is visible
   */
  async expectCreateDialogVisible(): Promise<void> {
    await expect(this.createDialog).toBeVisible();
  }

  /**
   * Get status page name from card
   * @param index - Card index
   */
  async getStatusPageName(index: number): Promise<string> {
    const card = this.statusPageCards.nth(index);
    const nameElement = card.locator('h3, h4, [class*="title"]').first();
    const txt = await nameElement.textContent();
    return txt ?? "";
  }
}

/**
 * Page Object for the Status Page Detail page (/status-pages/[id])
 */
export class StatusPageDetailPage extends BasePage {
  // Header elements
  readonly pageTitle: Locator;
  readonly statusBadge: Locator;
  readonly headline: Locator;
  readonly description: Locator;
  readonly subdomainUrl: Locator;
  readonly copyUrlButton: Locator;
  readonly previewButton: Locator;
  readonly publishButton: Locator;
  readonly unpublishButton: Locator;

  // Tabs
  readonly overviewTab: Locator;
  readonly componentsTab: Locator;
  readonly incidentsTab: Locator;
  readonly subscribersTab: Locator;
  readonly settingsTab: Locator;

  // Overview stats
  readonly componentsCount: Locator;
  readonly incidentsCount: Locator;
  readonly subscribersCount: Locator;
  readonly linkedMonitorsTable: Locator;

  // Component actions
  readonly createComponentButton: Locator;
  readonly componentTable: Locator;

  // Incident actions
  readonly createIncidentButton: Locator;
  readonly incidentTable: Locator;

  constructor(page: Page) {
    super(page);

    // Header elements
    this.pageTitle = page.locator("h1").first();

    this.statusBadge = page
      .locator('[class*="badge"]')
      .filter({ hasText: /published|draft|archived/i })
      .first();

    this.headline = page
      .locator('[data-testid="status-page-headline"]')
      .or(page.locator("p").filter({ hasText: /.+/ }).first());

    this.description = page.locator('[data-testid="status-page-description"]');

    this.subdomainUrl = page
      .locator('[data-testid="subdomain-url"]')
      .or(page.locator("code").first());

    this.copyUrlButton = page
      .locator('button[aria-label="Copy URL"]')
      .or(page.locator('button:has-text("Copy")'));

    this.previewButton = page
      .locator('button:has-text("Preview")')
      .or(page.locator('a:has-text("Preview")'));

    this.publishButton = page.locator('button:has-text("Publish")');

    this.unpublishButton = page.locator('button:has-text("Unpublish")');

    // Tabs
    this.overviewTab = page
      .locator('[role="tab"]:has-text("Overview")')
      .or(page.locator('button:has-text("Overview")'));

    this.componentsTab = page
      .locator('[role="tab"]:has-text("Components")')
      .or(page.locator('button:has-text("Components")'));

    this.incidentsTab = page
      .locator('[role="tab"]:has-text("Incidents")')
      .or(page.locator('button:has-text("Incidents")'));

    this.subscribersTab = page
      .locator('[role="tab"]:has-text("Subscribers")')
      .or(page.locator('button:has-text("Subscribers")'));

    this.settingsTab = page
      .locator('[role="tab"]:has-text("Settings")')
      .or(page.locator('button:has-text("Settings")'));

    // Overview stats
    this.componentsCount = page
      .locator('[data-testid="components-count"]')
      .or(
        page
          .locator("text=/components/i")
          .locator("..")
          .locator('[class*="count"]')
      );

    this.incidentsCount = page
      .locator('[data-testid="incidents-count"]')
      .or(
        page
          .locator("text=/incidents/i")
          .locator("..")
          .locator('[class*="count"]')
      );

    this.subscribersCount = page
      .locator('[data-testid="subscribers-count"]')
      .or(
        page
          .locator("text=/subscribers/i")
          .locator("..")
          .locator('[class*="count"]')
      );

    this.linkedMonitorsTable = page
      .locator('[data-testid="linked-monitors-table"]')
      .or(page.locator("table"));

    // Component actions
    this.createComponentButton = page
      .locator('button:has-text("Add Component")')
      .or(page.locator('button:has-text("Create Component")'));

    this.componentTable = page
      .locator('[data-testid="components-table"]')
      .or(page.locator("table"));

    // Incident actions
    this.createIncidentButton = page
      .locator('button:has-text("Create Incident")')
      .or(page.locator('button:has-text("Report Incident")'));

    this.incidentTable = page
      .locator('[data-testid="incidents-table"]')
      .or(page.locator("table"));
  }

  /**
   * Navigate to a specific status page detail
   * @param statusPageId - The status page ID
   */
  async navigate(statusPageId: string): Promise<void> {
    await this.goto(`/status-pages/${statusPageId}`);
    await this.waitForPageLoad();
  }

  /**
   * Click publish button
   */
  async clickPublish(): Promise<void> {
    await this.publishButton.click();
  }

  /**
   * Click unpublish button
   */
  async clickUnpublish(): Promise<void> {
    await this.unpublishButton.click();
  }

  /**
   * Click preview button
   */
  async clickPreview(): Promise<void> {
    await this.previewButton.click();
  }

  /**
   * Switch to overview tab
   */
  async switchToOverview(): Promise<void> {
    await this.overviewTab.click();
  }

  /**
   * Switch to components tab
   */
  async switchToComponents(): Promise<void> {
    await this.componentsTab.click();
  }

  /**
   * Switch to incidents tab
   */
  async switchToIncidents(): Promise<void> {
    await this.incidentsTab.click();
  }

  /**
   * Switch to subscribers tab
   */
  async switchToSubscribers(): Promise<void> {
    await this.subscribersTab.click();
  }

  /**
   * Switch to settings tab
   */
  async switchToSettings(): Promise<void> {
    await this.settingsTab.click();
  }

  /**
   * Assert page has loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/status-pages\/[^/]+/);
    await expect(this.pageTitle).toBeVisible();
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<string> {
    const badgeText = await this.statusBadge.textContent();
    return badgeText?.toLowerCase() || "";
  }

  /**
   * Check if publish button is visible
   */
  async isPublishButtonVisible(): Promise<boolean> {
    return this.publishButton.isVisible();
  }

  /**
   * Check if unpublish button is visible
   */
  async isUnpublishButtonVisible(): Promise<boolean> {
    return this.unpublishButton.isVisible();
  }
}
