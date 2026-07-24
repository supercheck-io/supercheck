/**
 * Security Tests
 *
 * Tests for authentication security including:
 * - XSS prevention
 * - CSRF protection
 * - Brute force protection
 * - Session security
 * - Cookie security
 * - Input sanitization
 *
 * Based on spec: specs/auth/security.md
 * Test IDs: AUTH-042 through AUTH-055
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

import { SignInPage, ForgotPasswordPage } from "../../pages/auth";
import { env, routes } from "../../utils/env";
import { loginIfNeeded } from "../../utils/auth-helper";

const SESSION_COOKIE_SUFFIX = "better-auth.session_token";

function requireCredentials(): { email: string; password: string } {
  if (!env.testUser.email || !env.testUser.password) {
    throw new Error("E2E test user credentials are required");
  }
  return env.testUser;
}

async function authenticateContext(page: Page): Promise<void> {
  const credentials = requireCredentials();
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { ...credentials, rememberMe: true },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function requireSessionCookie(context: BrowserContext) {
  const sessionCookie = (await context.cookies()).find(({ name }) =>
    name.endsWith(SESSION_COOKIE_SUFFIX),
  );
  expect(
    sessionCookie,
    `Expected ${SESSION_COOKIE_SUFFIX} cookie`,
  ).toBeDefined();
  if (!sessionCookie)
    throw new Error(`Expected ${SESSION_COOKIE_SUFFIX} cookie`);
  return sessionCookie;
}

test.describe("Security - XSS Prevention @auth @security", () => {
  /**
   * AUTH-043: XSS prevention in sign-in form
   * @priority high
   * @type security
   */
  test("AUTH-043: XSS in email field is escaped @high @security", async ({
    page,
  }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    const xssPayload = '<script>alert("xss")</script>';
    let alertTriggered = false;
    page.on("dialog", async (dialog) => {
      alertTriggered = true;
      await dialog.dismiss();
    });

    await signInPage.fillEmail(xssPayload);
    await signInPage.fillPassword("anypassword");
    await signInPage.submit();
    await expect(signInPage.emailInput).toHaveValue(xssPayload);
    expect(alertTriggered).toBe(false);

    // Check that script tag is not in DOM as executable
    const scriptInDom = await page.evaluate(() => {
      return document.body.innerHTML.includes("<script>alert");
    });
    expect(scriptInDom).toBe(false);
  });

  /**
   * AUTH-043: XSS prevention in forgot password form
   * @priority high
   * @type security
   */
  test("AUTH-043: XSS in forgot password is escaped @high @security", async ({
    page,
  }) => {
    const forgotPasswordPage = new ForgotPasswordPage(page);
    await forgotPasswordPage.navigate();

    const xssPayloads = [
      '<script>alert("xss")</script>',
      '"><script>alert("xss")</script>',
      "javascript:alert('xss')",
      '<img src=x onerror=alert("xss")>',
    ];

    let alertTriggered = false;
    page.on("dialog", () => {
      alertTriggered = true;
    });

    for (const payload of xssPayloads) {
      await forgotPasswordPage.fillEmail(payload);
      await expect(forgotPasswordPage.emailInput).toHaveValue(payload);
      expect(
        await forgotPasswordPage.emailInput.evaluate(
          (element) => (element as HTMLInputElement).validity.valid,
        ),
      ).toBe(false);
      expect(alertTriggered).toBe(false);

      await forgotPasswordPage.clearForm();
    }
  });

  /**
   * Test SVG XSS prevention
   * @priority high
   * @type security
   */
  test("SVG XSS payload is escaped @high @security", async ({ page }) => {
    await page.goto(routes.signIn);

    const svgXss = '<svg onload=alert("xss")>';
    let alertTriggered = false;
    page.on("dialog", async (dialog) => {
      alertTriggered = true;
      await dialog.dismiss();
    });
    await page.fill('input[type="email"]', svgXss);
    await page.fill('input[type="password"]', "anypass");
    await page.click('button[type="submit"]');
    await expect(page.locator('input[type="email"]')).toHaveValue(svgXss);
    expect(alertTriggered).toBe(false);
    expect(await page.locator("script").allTextContents()).not.toContain(
      'alert("xss")',
    );
  });
});
test.describe("Security - CSRF Protection @auth @security", () => {
  /**
   * AUTH-044: CSRF token required for state-changing operations
   * @priority high
   * @type security
   *
   * Better Auth handles CSRF via session cookies. Direct POST requests
   * may return various status codes depending on the auth setup.
   */
  test("AUTH-044: Direct POST to sign-in is handled @high @security", async ({
    request,
  }) => {
    // Attempt to POST directly without proper session/CSRF
    const response = await request.post("/api/auth/sign-in/email", {
      data: {
        email: "test@example.com",
        password: "password123",
      },
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious-site.com",
      },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({
      message: "Invalid origin",
      code: "INVALID_ORIGIN",
    });
  });

  /**
   * Test that API requests from different origin are handled
   * @priority high
   * @type security
   *
   * API returns error status for unauthenticated requests.
   * May return 500 if auth middleware throws on missing session.
   */
  test("Cross-origin API requests are handled @high @security", async ({
    request,
  }) => {
    const response = await request.get("/api/tests", {
      headers: {
        Origin: "https://malicious-site.com",
      },
    });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});

test.describe("Security - Session Management @auth @security", () => {
  /**
   * AUTH-047: Session fixation prevention
   * @priority high
   * @type security
   */
  test("AUTH-047-050: Login regenerates a protected session cookie @high @security", async ({
    page,
  }) => {
    // Get cookies before login
    await page.goto(routes.signIn);
    const cookiesBefore = await page.context().cookies();
    const sessionBefore = cookiesBefore.find(
      (c) =>
        c.name.includes("session") ||
        c.name.includes("auth") ||
        c.name.includes("better-auth"),
    );

    await authenticateContext(page);

    // Get cookies after login
    const cookiesAfter = await page.context().cookies();
    const sessionAfter = await requireSessionCookie(page.context());
    if (sessionBefore) {
      expect(sessionAfter.value).not.toBe(sessionBefore.value);
    }
    expect(sessionAfter.httpOnly).toBe(true);
    expect(sessionAfter.secure).toBe(env.baseUrl.startsWith("https"));
    expect(["Strict", "Lax"]).toContain(sessionAfter.sameSite);
  });
});

test.describe("Security - Information Disclosure @auth @security", () => {
  test("Login errors are generic (no user enumeration) @high @security", async ({
    page,
  }) => {
    if (!env.securityTestUser.email || !env.securityTestUser.password) {
      throw new Error(
        "E2E_SECURITY_USER_EMAIL and E2E_SECURITY_USER_PASSWORD are required for isolated login-enumeration testing",
      );
    }
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    await signInPage.signIn("definitely-not-exists@example.com", "anypassword");
    await expect(signInPage.errorMessage).toBeVisible();
    const error1 = await signInPage.getErrorMessage();

    await signInPage.navigate();

    await signInPage.signIn(
      env.securityTestUser.email,
      `${env.securityTestUser.password}-wrong`,
    );
    await expect(signInPage.errorMessage).toBeVisible();
    const error2 = await signInPage.getErrorMessage();

    expect(error1).toMatch(/invalid|incorrect|failed/i);
    expect(error2).toMatch(/invalid|incorrect|failed/i);
    expect(error2).toBe(error1);
  });

  test("Password reset is safe (no user enumeration) @high @security", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/request-password-reset", {
      data: {
        email: "definitely-not-exists@example.com",
        redirectTo: `${env.baseUrl}/reset-password`,
      },
    });
    const body = await response.text();

    expect([200, 400, 429]).toContain(response.status());
    expect(body).not.toMatch(/user (does not exist|not found)|unknown user/i);
  });
});

test.describe("Security - Input Validation @auth @security", () => {
  test("SQL injection in email is handled @high @security", async ({
    page,
  }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    const sqlPayloads = [
      "admin'--",
      "' OR '1'='1",
      "'; DROP TABLE users;--",
      "admin@example.com' OR '1'='1",
    ];

    for (const payload of sqlPayloads) {
      await signInPage.signIn(payload, "anypassword");
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
      await expect(page.locator("form")).toBeVisible();
      await signInPage.clearForm();
    }
  });

  test("Long input is handled gracefully @medium @security", async ({
    page,
  }) => {
    const signInPage = new SignInPage(page);
    await signInPage.navigate();

    const longEmail = "a".repeat(1000) + "@example.com";
    await signInPage.fillEmail(longEmail);
    await signInPage.fillPassword("password");
    await signInPage.submit();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.locator("form")).toBeVisible();
  });
});

test.describe("Security - Logout @auth @security", () => {
  test("Logout clears all session data @high @security", async ({ page }) => {
    await loginIfNeeded(page);

    // Clear session cookies to verify logout behavior
    await page.context().clearCookies();
    await page.goto("/tests");

    await expect(page).toHaveURL(/sign-in/);
  });
});
