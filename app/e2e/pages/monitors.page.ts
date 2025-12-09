import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";
import { routes } from "../utils/env";

/**
 * Page Object for the Monitors page (/monitors)
 *
 * Handles interactions with the monitors list including:
 * - Viewing monitor list with pagination
 * - Creating monitors
 * - Filtering and searching
 * - Pausing/resuming monitors
 * - Viewing monitor details
 */
export class MonitorsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly dataTable: Locator;
  readonly tableRows: Locator;
  readonly emptyState: Locator;

  // Filters
  readonly statusFilter: Locator;
  readonly typeFilter: Locator;

  // Pagination
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly pageIndicator: Locator;

  // Actions
  readonly rowActionsMenu: Locator;
  readonly editAction: Locator;
  readonly deleteAction: Locator;
  readonly pauseAction: Locator;
  readonly resumeAction: Locator;

  // Delete dialog
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Page elements
    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /monitors/i })
      .first();

    this.createButton = page
      .locator('[data-testid="create-monitor-button"]')
      .or(page.locator('button:has-text("Create Monitor")'))
      .or(page.locator('a:has-text("Create Monitor")'));

    this.searchInput = page
      .locator('[data-testid="search-input"]')
      .or(page.locator('input[placeholder*="Search"]'))
      .or(page.locator('input[placeholder*="search"]'));

    this.dataTable = page
      .locator('[data-testid="monitors-table"]')
      .or(page.locator("table"))
      .or(page.locator('[role="table"]'));

    this.tableRows = page.locator("tbody tr").or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator("text=/no monitors/i"))
      .or(page.locator("text=/create your first monitor/i"));

    // Filters
    this.statusFilter = page
      .locator('[data-testid="status-filter"]')
      .or(page.locator('button:has-text("Status")'));

    this.typeFilter = page
      .locator('[data-testid="type-filter"]')
      .or(page.locator('button:has-text("Type")'));

    // Pagination
    this.prevPageButton = page
      .locator('[data-testid="prev-page"]')
      .or(page.locator('button:has-text("Previous")'))
      .or(page.locator('button[aria-label="Previous page"]'));

    this.nextPageButton = page
      .locator('[data-testid="next-page"]')
      .or(page.locator('button:has-text("Next")'))
      .or(page.locator('button[aria-label="Next page"]'));

    this.pageIndicator = page
      .locator('[data-testid="page-indicator"]')
      .or(page.locator("text=/page \\d+ of \\d+/i"));

    // Row actions
    this.rowActionsMenu = page
      .locator('[data-testid="row-actions"]')
      .or(page.locator('button[aria-haspopup="menu"]'));

    this.editAction = page
      .locator('[data-testid="edit-action"]')
      .or(page.getByRole("menuitem", { name: /edit/i }));

    this.deleteAction = page
      .locator('[data-testid="delete-action"]')
      .or(page.getByRole("menuitem", { name: /delete/i }));

    this.pauseAction = page
      .locator('[data-testid="pause-action"]')
      .or(page.getByRole("menuitem", { name: /pause/i }));

    this.resumeAction = page
      .locator('[data-testid="resume-action"]')
      .or(page.getByRole("menuitem", { name: /resume/i }));

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
   * Navigate to the monitors page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.monitors);
    await this.waitForPageLoad();
  }

  /**
   * Click the create monitor button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
  }

  /**
   * Search for monitors
   * @param query - Search query
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(500);
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await this.page.waitForTimeout(500);
  }

  /**
   * Get the number of visible monitor rows
   */
  async getMonitorCount(): Promise<number> {
    await this.dataTable
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    return this.tableRows.count();
  }

  /**
   * Check if the monitors table is visible
   */
  async isTableVisible(): Promise<boolean> {
    return this.dataTable.isVisible();
  }

  /**
   * Check if empty state is shown
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return this.emptyState.isVisible();
  }

  /**
   * Click on a monitor row to view details
   * @param index - Row index (0-based)
   */
  async clickRow(index: number): Promise<void> {
    // Click the second cell (Name) to ensure we hit the navigation trigger
    // and avoid hitting checkboxes or other interactive elements in other columns
    await this.tableRows.nth(index).locator("td").nth(1).click();
  }

  /**
   * Open row actions menu for a monitor
   * @param index - Row index (0-based)
   */
  async openRowActions(index: number): Promise<void> {
    const row = this.tableRows.nth(index);
    const actionsButton = row
      .locator('button[aria-haspopup="menu"]')
      .or(row.locator("button").last());
    await actionsButton.click();
  }

  /**
   * Delete a monitor by row index
   * @param index - Row index (0-based)
   */
  async deleteMonitor(index: number): Promise<void> {
    await this.openRowActions(index);
    await this.deleteAction.click();
    await this.deleteConfirmButton.click();
  }

  /**
   * Pause a monitor by row index
   * @param index - Row index (0-based)
   */
  async pauseMonitor(index: number): Promise<void> {
    await this.openRowActions(index);
    await this.pauseAction.click();
  }

  /**
   * Resume a monitor by row index
   * @param index - Row index (0-based)
   */
  async resumeMonitor(index: number): Promise<void> {
    await this.openRowActions(index);
    await this.resumeAction.click();
  }

  /**
   * Filter by status
   * @param status - Monitor status (up, down, paused, pending, maintenance, error)
   */
  async filterByStatus(status: string): Promise<void> {
    await this.statusFilter.click();
    await this.page.locator(`[role="option"]:has-text("${status}")`).click();
  }

  /**
   * Filter by type
   * @param type - Monitor type (http_request, website, ping_host, port_check, synthetic_test)
   */
  async filterByType(type: string): Promise<void> {
    await this.typeFilter.click();
    await this.page.locator(`[role="option"]:has-text("${type}")`).click();
  }

  /**
   * Go to next page
   */
  async nextPage(): Promise<void> {
    await this.nextPageButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Go to previous page
   */
  async prevPage(): Promise<void> {
    await this.prevPageButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if next page button is enabled
   */
  async hasNextPage(): Promise<boolean> {
    return this.nextPageButton.isEnabled();
  }

  /**
   * Check if previous page button is enabled
   */
  async hasPrevPage(): Promise<boolean> {
    return this.prevPageButton.isEnabled();
  }

  /**
   * Assert page has loaded successfully
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/monitors/);
    const hasTable = await this.dataTable.isVisible().catch(() => false);
    const hasEmpty = await this.emptyState.isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBe(true);
  }

  /**
   * Assert create button is visible
   */
  async expectCreateButtonVisible(): Promise<void> {
    await expect(this.createButton).toBeVisible();
  }

  /**
   * Assert create button is hidden (no permission)
   */
  async expectCreateButtonHidden(): Promise<void> {
    await expect(this.createButton).toBeHidden();
  }

  /**
   * Get monitor name from row
   * @param index - Row index
   */
  async getMonitorName(index: number): Promise<string> {
    const row = this.tableRows.nth(index);
    const nameCell = row.locator("td").nth(1);
    const txt = await nameCell.textContent();
    return txt ?? "";
  }

  /**
   * Get monitor status from row
   * @param index - Row index
   */
  async getMonitorStatus(index: number): Promise<string> {
    const row = this.tableRows.nth(index);
    const statusBadge = row
      .locator('[class*="badge"], [class*="status"]')
      .first();
    const txt = await statusBadge.textContent();
    return txt ?? "";
  }
}

/**
 * Page Object for the Monitor Creation page (/monitors/create)
 */
export class MonitorCreatePage extends BasePage {
  readonly pageTitle: Locator;
  readonly httpMonitorCard: Locator;
  readonly websiteMonitorCard: Locator;
  readonly pingMonitorCard: Locator;
  readonly portMonitorCard: Locator;
  readonly syntheticMonitorCard: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /create|new monitor/i })
      .first();

    // Monitor type cards
    this.httpMonitorCard = page
      .locator('[data-testid="http-monitor-card"]')
      .or(page.locator("text=HTTP").locator(".."))
      .or(page.locator('a:has-text("HTTP")'));

    this.websiteMonitorCard = page
      .locator('[data-testid="website-monitor-card"]')
      .or(page.locator("text=Website").locator(".."))
      .or(page.locator('a:has-text("Website")'));

    this.pingMonitorCard = page
      .locator('[data-testid="ping-monitor-card"]')
      .or(page.locator("text=Ping").locator(".."))
      .or(page.locator('a:has-text("Ping")'));

    this.portMonitorCard = page
      .locator('[data-testid="port-monitor-card"]')
      .or(page.locator("text=Port").locator(".."))
      .or(page.locator('a:has-text("Port")'));

    this.syntheticMonitorCard = page
      .locator('[data-testid="synthetic-monitor-card"]')
      .or(page.locator("text=Synthetic").locator(".."))
      .or(page.locator('a:has-text("Synthetic")'));

    this.backButton = page
      .locator('[data-testid="back-button"]')
      .or(page.locator('a:has-text("Back")'))
      .or(page.locator('button:has-text("Back")'));
  }

  /**
   * Navigate to the monitor creation page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.monitorsCreate);
    await this.waitForPageLoad();
  }

  /**
   * Select HTTP monitor type
   */
  async selectHttpMonitor(): Promise<void> {
    await this.httpMonitorCard.click();
  }

  /**
   * Select Website monitor type
   */
  async selectWebsiteMonitor(): Promise<void> {
    await this.websiteMonitorCard.click();
  }

  /**
   * Select Ping monitor type
   */
  async selectPingMonitor(): Promise<void> {
    await this.pingMonitorCard.click();
  }

  /**
   * Select Port monitor type
   */
  async selectPortMonitor(): Promise<void> {
    await this.portMonitorCard.click();
  }

  /**
   * Select Synthetic monitor type
   */
  async selectSyntheticMonitor(): Promise<void> {
    await this.syntheticMonitorCard.click();
  }

  /**
   * Assert page has loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/monitors\/create/);
  }
}

/**
 * Page Object for the Monitor Detail page (/monitors/[id])
 */
export class MonitorDetailPage extends BasePage {
  readonly pageTitle: Locator;
  readonly statusIndicator: Locator;
  readonly editButton: Locator;
  readonly pauseButton: Locator;
  readonly deleteButton: Locator;
  readonly uptimeChart: Locator;
  readonly responseTimeChart: Locator;
  readonly recentChecks: Locator;
  readonly locationStats: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.locator("h1").first();

    this.statusIndicator = page
      .locator('[data-testid="monitor-status"]')
      .or(page.locator('[class*="status-indicator"]'));

    this.editButton = page
      .locator('[data-testid="edit-monitor"]')
      .or(page.locator('a:has-text("Edit")'))
      .or(page.locator('button:has-text("Edit")'));

    this.pauseButton = page
      .locator('[data-testid="pause-monitor"]')
      .or(page.locator('button:has-text("Pause")'));

    this.deleteButton = page
      .locator('[data-testid="delete-monitor"]')
      .or(page.locator('button:has-text("Delete")'));

    this.uptimeChart = page
      .locator('[data-testid="uptime-chart"]')
      .or(page.locator("text=Uptime").locator(".."));

    this.responseTimeChart = page
      .locator('[data-testid="response-time-chart"]')
      .or(page.locator("text=Response Time").locator(".."));

    this.recentChecks = page
      .locator('[data-testid="recent-checks"]')
      .or(page.locator("text=Recent Checks").locator(".."));

    this.locationStats = page
      .locator('[data-testid="location-stats"]')
      .or(page.locator("text=Location").locator(".."));
  }

  /**
   * Navigate to a specific monitor detail page
   * @param monitorId - The monitor ID
   */
  async navigate(monitorId: string): Promise<void> {
    await this.goto(`/monitors/${monitorId}`);
    await this.waitForPageLoad();
  }

  /**
   * Click edit button
   */
  async clickEdit(): Promise<void> {
    await this.editButton.click();
  }

  /**
   * Click pause button
   */
  async clickPause(): Promise<void> {
    await this.pauseButton.click();
  }

  /**
   * Assert page has loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/monitors\/[^/]+$/);
    await expect(this.pageTitle).toBeVisible();
  }
}
