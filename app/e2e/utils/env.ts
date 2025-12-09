/**
 * Environment Configuration for E2E Tests
 *
 * Centralizes all environment variable access with type safety and defaults.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
  baseUrl: process.env.E2E_BASE_URL || 'http://localhost:3000',

  /** Whether running in CI environment */
  isCI: !!process.env.CI,

  /** Test user credentials (must be an invited user with email/password) */
  testUser: {
    email: process.env.E2E_TEST_USER_EMAIL || '',
    password: process.env.E2E_TEST_USER_PASSWORD || '',
  } as UserCredentials,

  /** RBAC test users for role-based access control tests */
  rbacUsers: {
    /** Super Admin - platform-wide access */
    superAdmin: {
      email: process.env.E2E_SUPER_ADMIN_EMAIL || '',
      password: process.env.E2E_SUPER_ADMIN_PASSWORD || '',
    } as UserCredentials,

    /** Organization Owner - full org access including billing */
    orgOwner: {
      email: process.env.E2E_ORG_OWNER_EMAIL || '',
      password: process.env.E2E_ORG_OWNER_PASSWORD || '',
    } as UserCredentials,

    /** Organization Admin - org administration, no billing */
    orgAdmin: {
      email: process.env.E2E_ORG_ADMIN_EMAIL || '',
      password: process.env.E2E_ORG_ADMIN_PASSWORD || '',
    } as UserCredentials,

    /** Project Admin - project-level administration */
    projectAdmin: {
      email: process.env.E2E_PROJECT_ADMIN_EMAIL || '',
      password: process.env.E2E_PROJECT_ADMIN_PASSWORD || '',
    } as UserCredentials,

    /** Editor - can create and modify resources */
    editor: {
      email: process.env.E2E_EDITOR_EMAIL || '',
      password: process.env.E2E_EDITOR_PASSWORD || '',
    } as UserCredentials,

    /** Viewer - read-only access */
    viewer: {
      email: process.env.E2E_VIEWER_EMAIL || '',
      password: process.env.E2E_VIEWER_PASSWORD || '',
    } as UserCredentials,
  },

  /** Test data configuration */
  testData: {
    orgId: process.env.E2E_TEST_ORG_ID || '',
    projectId: process.env.E2E_TEST_PROJECT_ID || '',
  },

  /** Timeout configuration */
  timeout: parseInt(process.env.E2E_TIMEOUT || '30000', 10),
  retries: parseInt(process.env.E2E_RETRIES || '1', 10),
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

/**
 * Validates that required environment variables are set
 * @throws Error if required variables are missing
 */
export function validateEnv(): void {
  const required = ['E2E_BASE_URL', 'E2E_TEST_USER_EMAIL', 'E2E_TEST_USER_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please copy .env.example to .env and fill in the values.'
    );
  }
}

/**
 * Generates a unique test email for test isolation
 * @param prefix - Optional prefix for the email
 * @returns A unique email address
 */
export function generateTestEmail(prefix = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}@e2e-test.supercheck.io`;
}

/**
 * Generates a secure test password
 * @returns A secure password string
 */
export function generateTestPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
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
  signIn: '/sign-in',
  signUp: '/sign-up',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  authCallback: '/auth-callback',
  invite: (token: string) => `/invite/${token}`,

  // Main routes
  dashboard: '/',
  tests: '/tests',
  testsCreate: '/tests/create',
  jobs: '/jobs',
  jobsCreate: '/jobs/create',
  monitors: '/monitors',
  monitorsCreate: '/monitors/create',
  playground: '/playground',
  alerts: '/alerts',
  statusPages: '/status-pages',
  variables: '/variables',
  billing: '/billing',
  orgAdmin: '/org-admin',

  // Admin routes
  superAdmin: '/super-admin',
} as const;
