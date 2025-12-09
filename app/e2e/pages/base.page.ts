import { Page, Locator, expect } from "@playwright/test";

/**
 * Base Page Object class providing common functionality for all page objects.
 *
 * All page objects should extend this class to inherit common helpers
 * for navigation, waiting, and assertions.
 */
export class BasePage {
  // basePath is optional; some pages pass a default route for clarity
  constructor(
    protected page: Page,
    protected basePath?: string
  ) {}

  /**
   * Navigate to a specific URL path
   * @param path - The path to navigate to
   */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /**
   * Wait for the page to fully load
   * Note: Using 'domcontentloaded' instead of 'networkidle' for reliability
   * on production environments with SSE/websocket connections
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded");
  }

  /**
   * Wait for navigation to complete
   * @param urlPattern - Optional URL pattern to wait for
   */
  async waitForNavigation(urlPattern?: string | RegExp): Promise<void> {
    if (urlPattern) {
      await this.page.waitForURL(urlPattern);
    } else {
      await this.page.waitForLoadState("load");
    }
  }

  /**
   * Get element by data-testid attribute
   * @param testId - The data-testid value
   * @returns Locator for the element
   */
  getByTestId(testId: string): Locator {
    return this.page.locator(`[data-testid="${testId}"]`);
  }

  /**
   * Click an element by data-testid
   * @param testId - The data-testid value
   */
  async clickByTestId(testId: string): Promise<void> {
    await this.getByTestId(testId).click();
  }

  /**
   * Fill an input by data-testid
   * @param testId - The data-testid value
   * @param value - The value to fill
   */
  async fillByTestId(testId: string, value: string): Promise<void> {
    await this.getByTestId(testId).fill(value);
  }

  /**
   * Get text content of an element by data-testid
   * @param testId - The data-testid value
   * @returns The text content
   */
  async getTextByTestId(testId: string): Promise<string | null> {
    return this.getByTestId(testId).textContent();
  }

  /**
   * Check if an element is visible
   * @param testId - The data-testid value
   * @returns Whether the element is visible
   */
  async isVisibleByTestId(testId: string): Promise<boolean> {
    return this.getByTestId(testId).isVisible();
  }

  /**
   * Wait for an element to be visible
   * @param testId - The data-testid value
   * @param timeout - Optional timeout in milliseconds
   */
  async waitForTestId(testId: string, timeout?: number): Promise<void> {
    await this.getByTestId(testId).waitFor({
      state: "visible",
      timeout: timeout || 10000,
    });
  }

  /**
   * Wait for an element to be hidden
   * @param testId - The data-testid value
   * @param timeout - Optional timeout in milliseconds
   */
  async waitForTestIdHidden(testId: string, timeout?: number): Promise<void> {
    await this.getByTestId(testId).waitFor({
      state: "hidden",
      timeout: timeout || 10000,
    });
  }

  /**
   * Assert element is visible
   * @param testId - The data-testid value
   */
  async expectVisible(testId: string): Promise<void> {
    await expect(this.getByTestId(testId)).toBeVisible();
  }

  /**
   * Assert element is hidden
   * @param testId - The data-testid value
   */
  async expectHidden(testId: string): Promise<void> {
    await expect(this.getByTestId(testId)).toBeHidden();
  }

  /**
   * Assert element contains text
   * @param testId - The data-testid value
   * @param text - The expected text
   */
  async expectText(testId: string, text: string | RegExp): Promise<void> {
    await expect(this.getByTestId(testId)).toContainText(text);
  }

  /**
   * Assert current URL matches pattern
   * @param urlPattern - The expected URL or pattern
   */
  async expectUrl(urlPattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(urlPattern);
  }

  /**
   * Wait for toast notification to appear
   * @param message - Optional message to match
   */
  async waitForToast(message?: string | RegExp): Promise<Locator> {
    const toast = this.page.locator("[data-sonner-toast]").first();
    await toast.waitFor({ state: "visible" });
    if (message) {
      await expect(toast).toContainText(message);
    }
    return toast;
  }

  /**
   * Wait for toast to disappear
   */
  async waitForToastDismiss(): Promise<void> {
    await this.page
      .locator("[data-sonner-toast]")
      .first()
      .waitFor({ state: "hidden" });
  }

  /**
   * Wait for loading indicator to disappear
   */
  async waitForLoading(): Promise<void> {
    // Wait for any loading spinners to disappear
    const loadingIndicators = [
      '[data-testid="loading"]',
      '[data-testid="loading-spinner"]',
      ".animate-spin",
      '[role="progressbar"]',
    ];

    for (const selector of loadingIndicators) {
      const locator = this.page.locator(selector);
      if ((await locator.count()) > 0) {
        await locator.first().waitFor({ state: "hidden", timeout: 30000 });
      }
    }
  }

  /**
   * Take a screenshot with a descriptive name
   * @param name - The screenshot name
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  /**
   * Get the current page URL
   * @returns The current URL
   */
  getUrl(): string {
    return this.page.url();
  }

  /**
   * Get the current page title
   * @returns The page title
   */
  async getTitle(): Promise<string> {
    return this.page.title();
  }

  /**
   * Press a keyboard key
   * @param key - The key to press
   */
  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /**
   * Wait for a specific amount of time (use sparingly)
   * @param ms - Milliseconds to wait
   */
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}
