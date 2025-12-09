import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";
import { routes } from "../utils/env";

/**
 * Page Object for the Jobs page (/jobs)
 *
 * Handles interactions with the jobs list including:
 * - Viewing job list
 * - Creating jobs
 * - Running jobs
 * - Filtering and searching
 * - Viewing job details in side sheet
 */
export class JobsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly dataTable: Locator;
  readonly tableRows: Locator;
  readonly emptyState: Locator;

  // Filters
  readonly statusFilter: Locator;

  // Actions
  readonly rowActionsMenu: Locator;
  readonly editAction: Locator;
  readonly deleteAction: Locator;
  readonly runButton: Locator;

  // Side sheet (job details)
  readonly sideSheet: Locator;
  readonly sheetTitle: Locator;
  readonly sheetEditButton: Locator;
  readonly sheetCloseButton: Locator;
  readonly detailsTab: Locator;
  readonly testsTab: Locator;

  // Delete dialog
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Page elements
    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /jobs/i })
      .first();

    this.createButton = page
      .locator('[data-testid="create-job-button"]')
      .or(page.locator('button:has-text("Create Job")'))
      .or(page.locator('a:has-text("Create Job")'));

    this.searchInput = page
      .locator('[data-testid="search-input"]')
      .or(page.locator('input[placeholder*="Search"]'))
      .or(page.locator('input[placeholder*="search"]'));

    this.dataTable = page
      .locator('[data-testid="jobs-table"]')
      .or(page.locator("table"))
      .or(page.locator('[role="table"]'));

    this.tableRows = page.locator("tbody tr").or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator("text=/no jobs/i"))
      .or(page.locator("text=/create your first job/i"));

    // Filters
    this.statusFilter = page
      .locator('[data-testid="status-filter"]')
      .or(page.locator('button:has-text("Status")'));

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

    this.runButton = page
      .locator('[data-testid="run-job-button"]')
      .or(page.locator('button:has-text("Run")'));

    // Side sheet
    this.sideSheet = page
      .locator('[data-testid="job-detail-sheet"]')
      .or(page.locator('[role="dialog"]'))
      .or(page.locator(".sheet-content"));

    this.sheetTitle = this.sideSheet.locator("h2, h3").first();

    this.sheetEditButton = this.sideSheet.locator('button:has-text("Edit")');

    this.sheetCloseButton = this.sideSheet
      .locator('button[aria-label="Close"]')
      .or(this.sideSheet.locator('button:has-text("Close")'));

    this.detailsTab = page
      .locator('[data-testid="details-tab"]')
      .or(page.locator('[role="tab"]:has-text("Details")'));

    this.testsTab = page
      .locator('[data-testid="tests-tab"]')
      .or(page.locator('[role="tab"]:has-text("Tests")'));

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
   * Navigate to the jobs page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.jobs);
    await this.waitForPageLoad();
  }

  /**
   * Click the create job button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
  }

  /**
   * Search for jobs
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
   * Get the number of visible job rows
   */
  async getJobCount(): Promise<number> {
    await this.dataTable
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    return this.tableRows.count();
  }

  /**
   * Check if the jobs table is visible
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
   * Click on a job row to open details sheet
   * @param index - Row index (0-based)
   */
  async clickRow(index: number): Promise<void> {
    // Click the second cell (Name) to ensure we hit the navigation trigger
    // and avoid hitting checkboxes or other interactive elements in other columns
    await this.tableRows.nth(index).locator("td").nth(1).click();
  }

  /**
   * Open row actions menu for a job
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
   * Delete a job by row index
   * @param index - Row index (0-based)
   */
  async deleteJob(index: number): Promise<void> {
    await this.openRowActions(index);
    await this.deleteAction.click();
    await this.deleteConfirmButton.click();
  }

  /**
   * Run a job by clicking the Run button in the row
   * @param index - Row index (0-based)
   */
  async runJob(index: number): Promise<void> {
    const row = this.tableRows.nth(index);
    const runBtn = row.locator('button:has-text("Run")');
    await runBtn.click();
  }

  /**
   * Filter by status
   * @param status - Job status (pending, running, passed, failed, error, cancelled)
   */
  async filterByStatus(status: string): Promise<void> {
    await this.statusFilter.click();
    await this.page.locator(`[role="option"]:has-text("${status}")`).click();
  }

  /**
   * Wait for side sheet to be visible
   */
  async waitForSheet(): Promise<void> {
    await this.sideSheet.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Close the side sheet
   */
  async closeSheet(): Promise<void> {
    await this.sheetCloseButton.click();
    await this.sideSheet.waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Click edit button in the sheet
   */
  async clickSheetEdit(): Promise<void> {
    await this.sheetEditButton.click();
  }

  /**
   * Switch to tests tab in the sheet
   */
  async switchToTestsTab(): Promise<void> {
    await this.testsTab.click();
  }

  /**
   * Assert page has loaded successfully
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/jobs/);
    // Wait for page to settle
    await this.page.waitForTimeout(2000);

    const hasTable = await this.dataTable.isVisible().catch(() => false);
    const hasEmpty = await this.emptyState.isVisible().catch(() => false);
    // Also check for generic page content as fallback
    const hasPageContent = await this.page
      .locator('main, [role="main"], .container')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasTable || hasEmpty || hasPageContent).toBe(true);
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
   * Assert side sheet is visible
   */
  async expectSheetVisible(): Promise<void> {
    await expect(this.sideSheet).toBeVisible();
  }

  /**
   * Get job name from row
   * @param index - Row index
   */
  async getJobName(index: number): Promise<string> {
    const row = this.tableRows.nth(index);
    const nameCell = row.locator("td").nth(1);
    const txt = await nameCell.textContent();
    return txt ?? "";
  }

  /**
   * Get job status from row
   * @param index - Row index
   */
  async getJobStatus(index: number): Promise<string> {
    const row = this.tableRows.nth(index);
    // Status is usually indicated by a badge or specific class
    const statusBadge = row
      .locator('[class*="badge"], [class*="status"]')
      .first();
    const txt = await statusBadge.textContent();
    return txt ?? "";
  }
}

/**
 * Page Object for the Job Creation page (/jobs/create)
 */
export class JobCreatePage extends BasePage {
  readonly pageTitle: Locator;
  readonly playwrightCard: Locator;
  readonly k6Card: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /create|new job/i })
      .first();

    // Job type cards
    this.playwrightCard = page
      .locator('[data-testid="playwright-job-card"]')
      .or(page.locator("text=Playwright").locator(".."))
      .or(page.locator('a:has-text("Playwright")'));

    this.k6Card = page
      .locator('[data-testid="k6-job-card"]')
      .or(page.locator("text=K6").locator(".."))
      .or(page.locator('a:has-text("K6")'));

    this.backButton = page
      .locator('[data-testid="back-button"]')
      .or(page.locator('a:has-text("Back")'))
      .or(page.locator('button:has-text("Back")'));
  }

  /**
   * Navigate to the job creation page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.jobsCreate);
    await this.waitForPageLoad();
  }

  /**
   * Select Playwright job type
   */
  async selectPlaywright(): Promise<void> {
    await this.playwrightCard.click();
  }

  /**
   * Select K6 job type
   */
  async selectK6(): Promise<void> {
    await this.k6Card.click();
  }

  /**
   * Assert page has loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/jobs\/create/);
  }
}
