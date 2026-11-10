/**
 * Environment Configuration for E2E Tests
 *
 * Centralizes all environment variable access with type safety and defaults.
 */

import dotenv from "dotenv";
import path from "path";
import { SCREENSHOT_IDENTITIES, SCREENSHOT_USER } from "./screenshot";

// The PR gallery's checkpoint run uses the throwaway identities its seed created. Their
// passwords are public, so they are only ever tried against a local throwaway app.
const CHECKPOINTS = process.env.E2E_CHECKPOINTS === "1";
if (CHECKPOINTS) {
  const host = new URL(process.env.E2E_BASE_URL || "http://localhost:3000").hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(`E2E_CHECKPOINTS only runs against a local throwaway app, not ${host}`);
  }
}
function creds(prefix: string, fallback: UserCredentials): UserCredentials {
  const email = process.env[`${prefix}_EMAIL`] || "";
  const password = process.env[`${prefix}_PASSWORD`] || "";
  // All or nothing: never pair a real address with a throwaway password.
  if (CHECKPOINTS && !email && !password) return { email: fallback.email, password: fallback.password };
  return { email, password };
}

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });

/**
 * User credentials type
 */
interface UserCredentials {
  email: string;
  password: string;
}

/**
 * Test environment configuration
 */
export const env = {
  /** Base URL for the application under test */
  baseUrl: process.env.E2E_BASE_URL || "http://localhost:3000",

  /** Commit SHA that must be reported by the target deployment. */
  expectedBuildSha: process.env.E2E_EXPECTED_BUILD_SHA || "",

  /** Whether running in CI environment */
  isCI: !!process.env.CI,

  /** Test user credentials (must be an invited user with email/password) */
  testUser: creds("E2E_TEST_USER", SCREENSHOT_USER),

  /** Existing non-admin user kept outside the target organization for invitation acceptance tests. */
  inviteeUser: creds("E2E_INVITEE", SCREENSHOT_IDENTITIES.invitee),

  /** Dedicated identity whose sessions may be destructively invalidated without affecting other tests. */
  sessionTestUser: creds("E2E_SESSION_USER", SCREENSHOT_IDENTITIES.session),

  /** Dedicated identity for destructive failed-login and rate-limit security tests. */
  securityTestUser: creds("E2E_SECURITY_USER", SCREENSHOT_IDENTITIES.security),

  /** RBAC test users for role-based access control tests */
  rbacUsers: {
    /** Super Admin - platform-wide access */
    superAdmin: creds("E2E_SUPER_ADMIN", SCREENSHOT_IDENTITIES.superAdmin),

    /** Organization Owner - full org access including billing */
    orgOwner: creds("E2E_ORG_OWNER", SCREENSHOT_USER),

    /** Organization Admin - org administration, no billing */
    orgAdmin: creds("E2E_ORG_ADMIN", SCREENSHOT_IDENTITIES.orgAdmin),

    /** Project Admin - project-level administration */
    projectAdmin: creds("E2E_PROJECT_ADMIN", SCREENSHOT_IDENTITIES.projectAdmin),

    /** Editor - can create and modify resources */
    editor: creds("E2E_EDITOR", SCREENSHOT_IDENTITIES.editor),

    /** Viewer - read-only access */
    viewer: creds("E2E_VIEWER", SCREENSHOT_IDENTITIES.viewer),
  },

  /** Test data configuration */
  testData: {
    orgId: process.env.E2E_TEST_ORG_ID || "",
    projectId: process.env.E2E_TEST_PROJECT_ID || "",
  },

  /** Timeout configuration */
  timeout: parseInt(process.env.E2E_TIMEOUT || "30000", 10),
  retries: parseInt(process.env.E2E_RETRIES || "1", 10),
} as const;

/**
 * Check if RBAC user credentials are configured
 * @param role - The RBAC role to check
 * @returns true if credentials are configured
 */
export function hasRbacUser(role: keyof typeof env.rbacUsers): boolean {
  const user = env.rbacUsers[role];
  return !!(user.email && user.password);
}

export function requireRbacUser(role: keyof typeof env.rbacUsers): void {
  if (!hasRbacUser(role)) {
    throw new Error(
      `E2E ${role} credentials are required; role coverage may not be skipped`,
    );
  }
}

export function requireCredentials(
  credentials: UserCredentials,
  variableNames: string,
): void {
  if (!credentials.email || !credentials.password) {
    throw new Error(
      `${variableNames} are required; coverage may not be skipped`,
    );
  }
}

/**
 * Validates that required environment variables are set
 * @throws Error if required variables are missing
 */
export function validateEnv(): void {
  const required = [
    "E2E_BASE_URL",
    "E2E_TEST_USER_EMAIL",
    "E2E_TEST_USER_PASSWORD",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Please copy .env.example to .env and fill in the values.",
    );
  }
}

/**
 * Generates a unique test email for test isolation
 * @param prefix - Optional prefix for the email
 * @returns A unique email address
 */
export function generateTestEmail(prefix = "test"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}@e2e-test.invalid`;
}

/**
 * Generates a secure test password
 * @returns A secure password string
 */
export function generateTestPassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Route paths used in tests
 */
export const routes = {
  // Auth routes
  signIn: "/sign-in",
  signUp: "/sign-up",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  invite: (token: string) => `/invite/${token}`,

  // Main routes
  dashboard: "/",
  tests: "/tests",
  testsCreate: "/tests/create",
  jobs: "/jobs",
  jobsCreate: "/jobs/create",
  monitors: "/monitors",
  monitorsCreate: "/monitors/create",
  playground: "/playground",
  alerts: "/alerts",
  statusPages: "/status-pages",
  variables: "/variables",
  billing: "/billing",
  orgAdmin: "/org-admin",

  // Admin routes
  superAdmin: "/super-admin",
} as const;
