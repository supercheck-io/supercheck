import { test as base, Page, BrowserContext } from '@playwright/test';
import { SignInPage, SignUpPage, ForgotPasswordPage, InvitePage } from '../pages/auth';
import { env, routes } from '../utils/env';

/**
 * Authentication Test Fixtures
 *
 * Extends Playwright's base test with authentication-related fixtures:
 * - Page objects for auth pages
 * - Authenticated and unauthenticated page states
 * - Helper methods for common auth operations
 */

// Define custom fixture types
type AuthFixtures = {
  // Page objects
  signInPage: SignInPage;
  signUpPage: SignUpPage;
  forgotPasswordPage: ForgotPasswordPage;
  invitePage: InvitePage;

  // Page states
  authenticatedPage: Page;
  unauthenticatedPage: Page;

  // Auth helpers
  login: (email?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
};

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<AuthFixtures>({
  // Sign In Page Object
  signInPage: async ({ page }, use) => {
    const signInPage = new SignInPage(page);
    await use(signInPage);
  },

  // Sign Up Page Object
  signUpPage: async ({ page }, use) => {
    const signUpPage = new SignUpPage(page);
    await use(signUpPage);
  },

  // Forgot Password Page Object
  forgotPasswordPage: async ({ page }, use) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await use(forgotPasswordPage);
  },

  // Invite Page Object
  invitePage: async ({ page }, use) => {
    const invitePage = new InvitePage(page);
    await use(invitePage);
  },

  // Authenticated page - logs in using test user credentials
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login using test user credentials
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // If redirected to sign-in, login
    if (page.url().includes('/sign-in')) {
      const { env } = await import('../utils/env');
      if (!env.testUser.email || !env.testUser.password) {
        throw new Error('E2E_TEST_USER credentials required for authenticatedPage fixture');
      }
      const signInPage = new SignInPage(page);
      await signInPage.signIn(env.testUser.email, env.testUser.password);
      await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20000 });
    }

    await use(page);

    // Cleanup
    await context.close();
  },

  // Unauthenticated page - fresh context without auth
  unauthenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await use(page);

    // Cleanup
    await context.close();
  },

  // Login helper function
  login: async ({ page }, use) => {
    const loginFn = async (email?: string, password?: string) => {
      const signInPage = new SignInPage(page);
      await signInPage.navigate();
      await signInPage.signInAndWaitForDashboard(
        email || env.testUser.email,
        password || env.testUser.password
      );
    };

    await use(loginFn);
  },

  // Logout helper function
  logout: async ({ page }, use) => {
    const logoutFn = async () => {
      // Click user menu and sign out
      const userMenu = page
        .locator('[data-testid="user-menu"]')
        .or(page.locator('[data-testid="user-avatar"]'))
        .or(page.locator('button:has-text("Account")'));

      await userMenu.click();

      const signOutButton = page
        .locator('[data-testid="sign-out-button"]')
        .or(page.locator('button:has-text("Sign out")'))
        .or(page.locator('button:has-text("Logout")'));

      await signOutButton.click();

      // Wait for redirect to sign-in page
      await page.waitForURL(/sign-in/);
    };

    await use(logoutFn);
  },
});

// Re-export expect for convenience
export { expect } from '@playwright/test';

/**
 * Test annotations for filtering
 */
export const annotations = {
  critical: { type: 'critical' as const, description: 'Critical priority test' },
  high: { type: 'high' as const, description: 'High priority test' },
  medium: { type: 'medium' as const, description: 'Medium priority test' },
  low: { type: 'low' as const, description: 'Low priority test' },
  smoke: { type: 'smoke' as const, description: 'Smoke test' },
  security: { type: 'security' as const, description: 'Security test' },
  rbac: { type: 'rbac' as const, description: 'Role-based access control test' },
  positive: { type: 'positive' as const, description: 'Positive test case' },
  negative: { type: 'negative' as const, description: 'Negative test case' },
  edge: { type: 'edge' as const, description: 'Edge case test' },
};

/**
 * Helper to create test with tags
 */
export function createTaggedTest(
  testFn: typeof test,
  ...tags: Array<keyof typeof annotations>
) {
  return testFn.extend({});
}

/**
 * Wait for auth callback after OAuth
 * @param page - Playwright page
 */
export async function waitForAuthCallback(page: Page): Promise<void> {
  await page.waitForURL(/auth-callback/, { timeout: 30000 });
  // Wait for callback to process and redirect
  await page.waitForURL((url) => !url.pathname.includes('auth-callback'), {
    timeout: 30000,
  });
}

/**
 * Check if page is authenticated (not on sign-in page)
 * @param page - Playwright page
 * @returns Whether the page is authenticated
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  const url = page.url();
  return (
    !url.includes('/sign-in') &&
    !url.includes('/sign-up') &&
    !url.includes('/forgot-password')
  );
}

/**
 * Save current auth state to a file
 * @param context - Browser context
 * @param filename - Filename to save state to
 */
export async function saveAuthState(
  context: BrowserContext,
  filename: string
): Promise<void> {
  await context.storageState({ path: filename });
}
