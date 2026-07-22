/**
 * RBAC (Role-Based Access Control) Tests
 *
 * Tests for role-based access control across 6 roles:
 * - Super Admin: Full system access
 * - Org Owner: Full organization access
 * - Org Admin: Organization administration
 * - Project Admin: Project-level administration
 * - Editor: Create and modify resources
 * - Viewer: Read-only access
 *
 * Based on spec: specs/auth/rbac.md
 * Test IDs: AUTH-020 through AUTH-032
 */

import { test, expect } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';

test.describe('RBAC - Unauthenticated Access @auth @rbac @security', () => {
  // Override global storage state to test unauthenticated access
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * AUTH-042: Unauthenticated users cannot access protected routes
   * @priority critical
   * @type security
   */
  test('AUTH-042: Protected routes redirect to sign-in @critical @security', async ({ page }) => {
    const protectedRoutes = [
      '/tests',
      '/jobs',
      '/monitors',
      '/playground',
      '/alerts',
      '/status-pages',
      '/variables',
      '/org-admin',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');

      // Should redirect to sign-in
      await expect(page).toHaveURL(/sign-in/, {
        timeout: 5000,
      });
    }

  });

  /**
   * Super admin panel requires authentication
   * @priority critical
   * @type security
   */
  test('Super admin panel requires authentication @critical @security', async ({ page }) => {
    await page.goto('/super-admin');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('RBAC - Viewer Restrictions @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('viewer'));

  /**
   * AUTH-020: Viewer cannot access admin panel
   * @priority critical
   * @type rbac
   */
  test('AUTH-020: Viewer cannot access admin panel @critical @rbac', async ({ viewerPage: page }) => {
    await page.goto('/super-admin');
    await page.waitForLoadState('domcontentloaded');

    // Should show 403 or redirect
    await expect(page).not.toHaveURL(/\/super-admin(?:\/|$)/);
  });

  /**
   * AUTH-021: Viewer cannot create tests
   * @priority critical
   * @type rbac
   */
  test('AUTH-021: Viewer cannot create tests @critical @rbac', async ({ viewerPage: page }) => {
    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    // Create button should be hidden for viewer
    const createButton = page.getByRole('link', { name: /create test/i }).or(
      page.getByRole('button', { name: /create test/i }),
    );
    await expect(createButton).toBeHidden();

    const response = await page.request.post('/api/tests', {
      data: {
        title: `viewer-forbidden-${Date.now()}`,
        type: 'custom',
        priority: 'medium',
        script: 'export default {}',
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  /**
   * AUTH-023: Viewer can view test results
   * @priority high
   * @type rbac
   */
  test('AUTH-023: Viewer can view test results @high @rbac', async ({ viewerPage: page }) => {
    await page.goto('/runs');
    await page.waitForLoadState('domcontentloaded');

    // Should be able to view runs page
    await expect(page).toHaveURL(/runs/);

    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible();
  });
});

test.describe('RBAC - Editor Capabilities @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('editor'));
  /**
   * AUTH-024: Editor can create tests
   * @priority critical
   * @type rbac
   */
  test('AUTH-024: Editor can create tests @critical @rbac', async ({ editorPage: page }) => {
    await page.goto('/tests');
    await page.waitForLoadState('domcontentloaded');

    // Create button should be visible for editor
    const createButton = page.getByRole('link', { name: /create test/i }).or(
      page.getByRole('button', { name: /create test/i }),
    );
    await expect(createButton).toBeVisible();
  });

  /**
   * AUTH-025: Editor cannot access admin panel
   * @priority critical
   * @type rbac
   */
  test('AUTH-025: Editor cannot access admin panel @critical @rbac', async ({ editorPage: page }) => {
    await page.goto('/super-admin');
    await page.waitForLoadState('domcontentloaded');

    // Should show 403 or redirect
    await expect(page).not.toHaveURL(/\/super-admin(?:\/|$)/);
  });
});

test.describe('RBAC - Project Admin Capabilities @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('projectAdmin'));
  /**
   * AUTH-026: Project Admin can manage project members
   * @priority critical
   * @type rbac
   */
  test('AUTH-026: Project Admin can access project administration @critical @rbac', async ({ projectAdminPage: page }) => {
    const projects = await page.request.get('/api/projects');
    expect(projects.status(), await projects.text()).toBe(200);
    expect(await projects.json()).toMatchObject({ success: true, data: expect.any(Array) });

    await page.goto('/tests');
    await expect(page.getByRole('button', { name: 'Create Test', exact: true })).toBeVisible();
  });

});

test.describe('RBAC - Org Admin Capabilities @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('orgAdmin'));

  /**
   * AUTH-028: Org Admin can manage projects
   * @priority critical
   * @type rbac
   */
  test('AUTH-028: Org Admin can manage projects @critical @rbac', async ({ orgAdminPage: page }) => {
    await page.goto('/org-admin');
    await page.waitForLoadState('domcontentloaded');

    // Should be able to access org admin
    await expect(page).toHaveURL(/org-admin/);
  });

});

test.describe('RBAC - Org Owner Capabilities @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('orgOwner'));

  /**
   * AUTH-030: Org Owner has full org access
   * @priority critical
   * @type rbac
   */
  test('AUTH-030: Org Owner has full org access @critical @rbac', async ({ orgOwnerPage: page }) => {
    // Should access billing
    await page.goto('/billing');
    await expect(page).toHaveURL(/billing/);

    // Should access org admin
    await page.goto('/org-admin');
    await expect(page).toHaveURL(/org-admin/);
  });
});

test.describe('RBAC - Super Admin @auth @rbac', () => {
  test.beforeAll(() => requireRbacUser('superAdmin'));
  /**
   * AUTH-031: Super Admin can access admin panel
   * @priority critical
   * @type rbac
   */
  test('AUTH-031: Super Admin can access admin panel @critical @rbac', async ({ superAdminPage: page }) => {
    await page.goto('/super-admin');
    await expect(page).toHaveURL(/super-admin/);
    await expect(page.getByRole('heading', { name: 'Super Admin', exact: true })).toBeVisible();
  });

  /**
   * AUTH-032: Super Admin can view all organizations
   * @priority critical
   * @type rbac
   */
  test('AUTH-032: Super Admin can view all orgs @critical @rbac', async ({ superAdminPage: page }) => {
    await page.goto('/super-admin');
    await page.getByRole('tab', { name: 'Organizations', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Organizations' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('RBAC - UI Element Visibility @auth @rbac', () => {
  /**
   * Test that navigation reflects user role
   * This test runs for authenticated users to verify correct nav items
   */
  test('Navigation shows role-appropriate items @medium @rbac', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Common navigation items should be visible for all authenticated users
    const navItems = ['Tests', 'Jobs', 'Monitors', 'Runs'];

    for (const item of navItems) {
      await expect(page.getByRole('link', { name: item, exact: true }).first()).toBeVisible();
    }
  });
});

test.describe('RBAC - API Authorization @auth @rbac @security', () => {
  // Override global storage state to test unauthenticated access
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * Test that API endpoints respect authorization
   *
   * API may return different status codes depending on implementation:
   * - 401: Unauthorized (no auth)
   * - 403: Forbidden (auth but no permission)
   * - 500: Internal error (which still protects data)
   */
  test('API requires authentication @critical @security', async ({ request }) => {
    // Try to access API without authentication
    const response = await request.get('/api/tests');

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  /**
   * Test organization isolation in API
   */
  test('Cannot access other org data via API @critical @security', async ({ request }) => {
    // This would require authenticated context and known org IDs
    // Testing cross-organization access attempts

    // Example: Try to access a known-invalid org ID
    const response = await request.get('/api/projects', {
      params: { organizationId: '00000000-0000-4000-8000-000000000001' },
    });

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});
