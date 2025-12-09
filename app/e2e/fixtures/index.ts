/**
 * Test Fixtures Export
 *
 * Central export for all test fixtures.
 */

export {
  test as authTest,
  expect,
  annotations,
  waitForAuthCallback,
  isAuthenticated,
  saveAuthState,
} from './auth.fixture';

export {
  test as roleTest,
  Role,
  rolePermissions,
  type RoleType,
} from './roles.fixture';

// Merge both fixtures for tests that need both auth and role capabilities
import { test as authTest } from './auth.fixture';
import { test as roleTest } from './roles.fixture';
import { mergeTests } from '@playwright/test';

/**
 * Combined test fixture with both auth and role capabilities
 */
export const test = mergeTests(authTest, roleTest);
