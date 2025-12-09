import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";
import { routes } from "../utils/env";

/**
 * Page Object for the Tests page (/tests)
 *
 * Handles interactions with the tests list including:
 * - Viewing test list
 * - Creating tests
 * - Filtering and searching
 * - Deleting tests
 */
export class TestsPage extends BasePage {
  // Page elements
  readonly pageTitle: Locator;
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly dataTable: Locator;
  readonly tableRows: Locator;
  readonly emptyState: Locator;

  // Filters
  readonly typeFilter: Locator;
  readonly priorityFilter: Locator;
  readonly tagFilter: Locator;

  // Actions
  readonly rowActionsMenu: Locator;
  readonly editAction: Locator;
  readonly deleteAction: Locator;

  // Delete dialog
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Page elements - using flexible selectors
    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /tests/i })
      .first();

    this.createButton = page
      .locator('[data-testid="create-test-button"]')
      .or(page.locator('button:has-text("Create Test")'))
      .or(page.locator('a:has-text("Create Test")'));

    this.searchInput = page
      .locator('[data-testid="search-input"]')
      .or(page.locator('input[placeholder*="Search"]'))
      .or(page.locator('input[placeholder*="search"]'));

    this.dataTable = page
      .locator('[data-testid="tests-table"]')
      .or(page.locator("table"))
      .or(page.locator('[role="table"]'));

    this.tableRows = page.locator("tbody tr").or(page.locator('[role="row"]'));

    this.emptyState = page
      .locator('[data-testid="empty-state"]')
      .or(page.locator("text=/no tests/i"))
      .or(page.locator("text=/create your first test/i"));

    // Filters
    this.typeFilter = page
      .locator('[data-testid="type-filter"]')
      .or(page.locator('button:has-text("Type")'));

    this.priorityFilter = page
      .locator('[data-testid="priority-filter"]')
      .or(page.locator('button:has-text("Priority")'));

    this.tagFilter = page
      .locator('[data-testid="tag-filter"]')
      .or(page.locator('button:has-text("Tags")'));

    // Row actions
    this.rowActionsMenu = page
      .locator('[data-testid="row-actions"]')
      .or(page.locator('button[aria-haspopup="menu"]'))
      .or(page.locator('button:has([class*="more"])'));

    this.editAction = page
      .locator('[data-testid="edit-action"]')
      .or(page.getByRole("menuitem", { name: /edit/i }));

    this.deleteAction = page
      .locator('[data-testid="delete-action"]')
      .or(page.getByRole("menuitem", { name: /delete/i }));

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
   * Navigate to the tests page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.tests);
    await this.waitForPageLoad();
  }

  /**
   * Click the create test button
   */
  async clickCreate(): Promise<void> {
    await this.createButton.click();
  }

  /**
   * Search for tests
   * @param query - Search query
   */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Wait for search to apply
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
   * Get the number of visible test rows
   */
  async getTestCount(): Promise<number> {
    await this.dataTable
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
    return this.tableRows.count();
  }

  /**
   * Check if the tests table is visible
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
   * Click on a test row by index
   * @param index - Row index (0-based)
   */
  async clickRow(index: number): Promise<void> {
    await this.tableRows.nth(index).click();
  }

  /**
   * Open row actions menu for a test
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
   * Delete a test by row index
   * @param index - Row index (0-based)
   */
  async deleteTest(index: number): Promise<void> {
    await this.openRowActions(index);
    await this.deleteAction.click();
    await this.deleteConfirmButton.click();
  }

  /**
   * Filter by type
   * @param type - Test type (browser, api, database, custom, performance)
   */
  async filterByType(type: string): Promise<void> {
    await this.typeFilter.click();
    await this.page.locator(`[role="option"]:has-text("${type}")`).click();
  }

  /**
   * Filter by priority
   * @param priority - Priority level (low, medium, high)
   */
  async filterByPriority(priority: string): Promise<void> {
    await this.priorityFilter.click();
    await this.page.locator(`[role="option"]:has-text("${priority}")`).click();
  }

  /**
   * Assert page has loaded successfully
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/tests/);
    // Wait for content
    await this.page.waitForTimeout(2000);
    // Either table, empty state, or main content should be visible
    const hasTable = await this.dataTable.isVisible().catch(() => false);
    const hasEmpty = await this.emptyState.isVisible().catch(() => false);
    const hasMain = await this.page
      .locator("main")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmpty || hasMain).toBe(true);
  }

  /**
   * Assert create button is visible
   */
  async expectCreateButtonVisible(): Promise<void> {
    // Try multiple selectors for create button
    const createBtn = this.page
      .locator('[data-testid="create-test-button"]')
      .or(this.page.locator('button:has-text("Create")'))
      .or(this.page.locator('a:has-text("Create")'))
      .or(this.page.locator('button:has-text("New")'))
      .first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert create button is hidden (no permission)
   */
  async expectCreateButtonHidden(): Promise<void> {
    await expect(this.createButton).toBeHidden();
  }

  /**
   * Get test name from row
   * @param index - Row index
   */
  async getTestName(index: number): Promise<string> {
    const row = this.tableRows.nth(index);
    const nameCell = row.locator("td").nth(1); // Usually second column is name
    const txt = await nameCell.textContent();
    return txt ?? "";
  }
}

/**
 * Page Object for the Test Creation page (/tests/create)
 */
export class TestCreatePage extends BasePage {
  readonly pageTitle: Locator;
  readonly browserTestCard: Locator;
  readonly apiTestCard: Locator;
  readonly customTestCard: Locator;
  readonly databaseTestCard: Locator;
  readonly performanceTestCard: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /create|new test/i })
      .first();

    // Test type cards
    this.browserTestCard = page
      .locator('[data-testid="browser-test-card"]')
      .or(page.locator("text=Browser Test").locator(".."))
      .or(page.locator('a:has-text("Browser")'));

    this.apiTestCard = page
      .locator('[data-testid="api-test-card"]')
      .or(page.locator("text=API Test").locator(".."))
      .or(page.locator('a:has-text("API")'));

    this.customTestCard = page
      .locator('[data-testid="custom-test-card"]')
      .or(page.locator("text=Custom Test").locator(".."))
      .or(page.locator('a:has-text("Custom")'));

    this.databaseTestCard = page
      .locator('[data-testid="database-test-card"]')
      .or(page.locator("text=Database Test").locator(".."))
      .or(page.locator('a:has-text("Database")'));

    this.performanceTestCard = page
      .locator('[data-testid="performance-test-card"]')
      .or(page.locator("text=Performance Test").locator(".."))
      .or(page.locator('a:has-text("Performance")'));

    this.backButton = page
      .locator('[data-testid="back-button"]')
      .or(page.locator('a:has-text("Back")'))
      .or(page.locator('button:has-text("Back")'));
  }

  /**
   * Navigate to the test creation page
   */
  async navigate(): Promise<void> {
    await this.goto(routes.testsCreate);
    await this.waitForPageLoad();
  }

  /**
   * Select browser test type
   */
  async selectBrowserTest(): Promise<void> {
    await this.browserTestCard.click();
  }

  /**
   * Select API test type
   */
  async selectApiTest(): Promise<void> {
    await this.apiTestCard.click();
  }

  /**
   * Select custom test type
   */
  async selectCustomTest(): Promise<void> {
    await this.customTestCard.click();
  }

  /**
   * Assert page has loaded
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/tests\/create/);
  }
}
