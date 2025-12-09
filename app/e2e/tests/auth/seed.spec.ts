/**
 * Seed Test for Playwright Agents
 *
 * This is the bootstrap test that provides context to Playwright Agents
 * about the testing environment, patterns, and conventions used in this project.
 *
 * The seed test demonstrates:
 * - Page Object Model usage
 * - Authentication patterns
 * - data-testid selector conventions
 * - Assertion patterns
 * - Handling real-time updates (SSE)
 * - Error handling patterns
 *
 * @see https://playwright.dev/docs/test-agents
 */

import { test, expect } from '@playwright/test';
import { SignInPage, SignUpPage } from '../../pages/auth';
import { env, routes } from '../../utils/env';

test.describe('Seed Tests - Authentication Foundation', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * AUTH-SEED-001: Verify sign-in page loads correctly
   *
   * This test verifies the basic structure of the sign-in page.
   * It demonstrates:
   * - Navigation to a specific route
   * - Using Page Object Model
   * - Basic element visibility assertions
   */
  test('sign-in page loads with all expected elements', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);

    // Act
    await signInPage.navigate();

    // Assert - Page structure
    await expect(page).toHaveURL(/sign-in/);
    await expect(signInPage.emailInput).toBeVisible();
    await expect(signInPage.passwordInput).toBeVisible();
    await expect(signInPage.submitButton).toBeVisible();
  });



  /**
   * AUTH-SEED-003: Verify error handling on invalid login
   *
   * Demonstrates:
   * - Negative test case pattern
   * - Error message assertions
   * - Form interaction
   *
   * NOTE: Due to rate limiting, the error message might be:
   * - "Invalid credentials" / "Incorrect password" on first attempts
   * - "Too many requests" if rate limited
   */
  test('shows error message for invalid credentials', async ({ page }) => {
    // Arrange
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Act - Try to login with invalid credentials
    await signInPage.signIn('invalid@example.com', 'wrong-password');

    // Assert - Error message should appear
    // Can be auth error OR rate limit error (both are acceptable)
    await signInPage.expectError(/invalid|incorrect|failed|too many|rate limit/i);
  });

  /**
   * AUTH-SEED-004: Verify navigation between auth pages
   *
   * Demonstrates:
   * - Multi-page navigation
   * - Link clicking
   * - URL assertions
   * NOTE: Sign-up navigation removed since app uses OAuth (no sign-up link without invite)
   */
  test('can navigate between auth pages', async ({ page }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    // Navigate to forgot password
    await signInPage.clickForgotPassword();
    await expect(page).toHaveURL(/forgot-password/);

    // Navigate back to sign-in
    const backLink = page.locator('a:has-text("Sign in")').or(page.locator('a:has-text("Back")'));
    await backLink.click();
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe('Seed Tests - Selector Patterns', () => {
  /**
   * SELECTOR-SEED-001: Demonstrate data-testid usage
   *
   * Shows the preferred selector strategy using data-testid attributes.
   * This is the most stable selector approach for E2E tests.
   */
  test('data-testid selectors are reliable', async ({ page }) => {
    await page.goto(routes.signIn);

    // Preferred: data-testid selectors
    const emailByTestId = page.locator('[data-testid="login-email-input"]');
    const emailById = page.locator('#email');
    const emailByName = page.locator('input[name="email"]');

    // At least one selector should work
    const emailInput = emailByTestId.or(emailById).or(emailByName);
    await expect(emailInput).toBeVisible();

    // Fill using the found selector
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
  });

  /**
   * SELECTOR-SEED-002: Demonstrate button selectors
   *
   * Shows multiple strategies for finding buttons.
   */
  test('button selectors with multiple strategies', async ({ page }) => {
    await page.goto(routes.signIn);

    // Multiple selector strategies for submit button
    const submitButton = page
      .locator('[data-testid="login-submit-button"]')
      .or(page.locator('button[type="submit"]'))
      .or(page.locator('button:has-text("Login")'))
      .or(page.locator('button:has-text("Sign in")'));

    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });
});

test.describe('Seed Tests - Assertion Patterns', () => {
  /**
   * ASSERT-SEED-001: Common assertion patterns
   *
   * Demonstrates various assertion types used throughout tests.
   */
  test('demonstrates assertion patterns', async ({ page }) => {
    await page.goto(routes.signIn);

    // Visibility assertions
    await expect(page.locator('form')).toBeVisible();

    // Text content assertions
    await expect(page.locator('h1, h2')).toContainText(/sign in|login|welcome/i);

    // URL assertions
    await expect(page).toHaveURL(/sign-in/);

    // Input value assertions
    const emailInput = page.locator('#email').or(page.locator('input[name="email"]'));
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');

    // Attribute assertions
    await expect(emailInput).toHaveAttribute('type', 'email');
  });

  /**
   * ASSERT-SEED-002: Async assertions with waits
   *
   * Demonstrates waiting for dynamic content.
   */
  test('handles async content correctly', async ({ page }) => {
    await page.goto(routes.signIn);

    // Wait for page to be fully loaded
    await page.waitForLoadState('domcontentloaded');

    // Wait for specific element
    const form = page.locator('form');
    await form.waitFor({ state: 'visible' });

    // Assertions with custom timeouts
    await expect(page.locator('button[type="submit"]')).toBeEnabled({
      timeout: 5000,
    });
  });
});

test.describe('Seed Tests - Environment Configuration', () => {
  /**
   * ENV-SEED-001: Verify environment is properly configured
   *
   * Ensures test environment variables are set correctly.
   */
  test('environment variables are configured', async () => {
    // Base URL should be set
    expect(env.baseUrl).toBeTruthy();
    expect(env.baseUrl).toMatch(/^https?:\/\//);

    // Test user credentials should be set
    expect(env.testUser.email).toBeTruthy();
    expect(env.testUser.password).toBeTruthy();
  });

  /**
   * ENV-SEED-002: Routes are correctly defined
   *
   * Verifies route configuration matches expected patterns.
   */
  test('routes are correctly defined', async () => {
    expect(routes.signIn).toBe('/sign-in');
    expect(routes.signUp).toBe('/sign-up');
    expect(routes.forgotPassword).toBe('/forgot-password');
    expect(routes.dashboard).toBe('/');
    expect(routes.invite('test-token')).toBe('/invite/test-token');
  });
});

/**
 * Instructions for Playwright Agents:
 *
 * 1. SELECTORS:
 *    - Always prefer [data-testid="..."] selectors
 *    - Use .or() to chain fallback selectors for robustness
 *    - Avoid fragile selectors like CSS classes or tag hierarchies
 *
 * 2. PAGE OBJECTS:
 *    - All page interactions should go through page objects
 *    - Page objects are in ../pages/ directory
 *    - Extend BasePage for common functionality
 *
 * 3. FIXTURES:
 *    - Use auth.fixture.ts for authenticated tests
 *    - Use roles.fixture.ts for RBAC tests
 *    - Import from ../fixtures/
 *
 * 4. ASSERTIONS:
 *    - Use Playwright's expect() with locators
 *    - Always use await with assertions
 *    - Include meaningful timeouts for async operations
 *
 * 5. TEST ORGANIZATION:
 *    - Group related tests in describe blocks
 *    - Use test IDs from the specification (e.g., AUTH-001)
 *    - Add appropriate tags (@critical, @smoke, @security, etc.)
 *
 * 6. ENVIRONMENT:
 *    - Access config through utils/env.ts
 *    - Never hardcode URLs or credentials
 *    - Use routes constant for navigation paths
 */
