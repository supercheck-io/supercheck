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
import { requireCredentials, requireRbacUser, env } from '../../utils/env';
import { authenticateWithApi } from '../../utils/api-auth';

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

    // Keep the action visible for discoverability, but make it non-actionable.
    // Server-side authorization below remains the security boundary.
    const createButton = page.getByRole('button', { name: /create test/i });
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeDisabled();

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

  test('Viewer cannot add variables @high @rbac', async ({ viewerPage: page }) => {
    const permissions = page.waitForResponse((response) =>
      /\/api\/projects\/[^/]+\/variables$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'GET',
    );
    await page.goto('/variables');
    const response = await permissions;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      canCreateEdit: false,
      canManage: false,
    });
    await expect(page.getByText('Loading data...', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Variable', exact: true })).toBeDisabled();
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
    await expect(createButton).toBeEnabled();
  });

  test('Editor can open the variable form @high @rbac', async ({ editorPage: page }) => {
    await page.goto('/variables');
    await page.getByRole('button', { name: 'Add Variable', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Variable Name *', { exact: true })).toBeEditable();
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
    await expect(page.getByRole('button', { name: 'Create Test', exact: true })).toBeEnabled();
  });

  test('Project admin can open the variable form @high @rbac', async ({ projectAdminPage: page }) => {
    await page.goto('/variables');
    await page.getByRole('button', { name: 'Add Variable', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Variable Name *', { exact: true })).toBeEditable();
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
    // The legacy billing route must resolve to the canonical subscription tab.
    await page.goto('/billing');
    await expect(page).toHaveURL(/\/org-admin\?tab=subscription$/);

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
   * Unauthenticated callers get a 401 before any tenant scoping runs.
   */
  test('API requires authentication @critical @security', async ({ request }) => {
    // Try to access API without authentication
    const response = await request.get('/api/tests');

    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });
});

/**
 * Cross-tenant isolation needs two *authenticated* identities. The previous
 * version of this check sent an unauthenticated request and asserted 401, which
 * proved only that the auth middleware runs, not that tenant boundaries hold.
 *
 * Here the organization owner (positive control) and an existing user who
 * belongs to a different organization (the outsider) call the same endpoints.
 * The owner must read the resource and the outsider must not.
 */
test.describe('RBAC - Cross-tenant API isolation @auth @rbac @security', () => {
  test('an authenticated outsider cannot read another organization\'s project data @critical @security', async ({
    orgOwnerPage,
    playwright,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required');
    requireRbacUser('orgOwner');
    requireCredentials(env.inviteeUser, 'E2E_INVITEE_EMAIL and E2E_INVITEE_PASSWORD');

    // A previously aborted invitation run can leave the outsider inside the
    // owner's organization, which would turn this denial test into a false
    // positive. Remove any leftover membership first, mirroring invitations.spec.ts.
    const outsiderEmail = env.inviteeUser.email.toLowerCase().trim();
    const membersResponse = await orgOwnerPage.request.get('/api/organizations/members');
    expect(membersResponse.status()).toBe(200);
    const membersBody = (await membersResponse.json()) as {
      data: { members: Array<{ id: string; email: string }> };
    };
    const lingeringMembership = membersBody.data.members.find(
      (member) => member.email.toLowerCase() === outsiderEmail,
    );
    if (lingeringMembership) {
      const removeResponse = await orgOwnerPage.request.delete(
        `/api/organizations/members/${lingeringMembership.id}`,
      );
      expect(removeResponse.status()).toBe(200);
    }

    const ownerProjects = (await (
      await orgOwnerPage.request.get('/api/projects')
    ).json()) as { currentProject?: { id?: string; organizationId?: string } };
    const ownerProjectId = ownerProjects.currentProject?.id;
    const ownerOrganizationId = ownerProjects.currentProject?.organizationId;
    if (!ownerProjectId || !ownerOrganizationId) {
      throw new Error('org owner must have an active project and organization');
    }

    // Positive control: the resource exists and its owner can read it, so a
    // later denial cannot be explained by the endpoint being broken.
    const ownerVariables = await orgOwnerPage.request.get(
      `/api/projects/${ownerProjectId}/variables`,
    );
    expect(ownerVariables.status()).toBe(200);

    const storageState = await authenticateWithApi(
      playwright.request,
      baseURL,
      env.inviteeUser,
      { requireProjectContext: false },
    );
    const origin = new URL(baseURL).origin;
    const outsider = await playwright.request.newContext({
      baseURL,
      storageState,
      extraHTTPHeaders: { Origin: origin, Referer: `${origin}/sign-in` },
    });

    try {
      // Direct object access: the outsider knows the real project id.
      const variablesResponse = await outsider.get(
        `/api/projects/${ownerProjectId}/variables`,
      );
      expect(
        [403, 404],
        `outsider must not read project variables (got ${variablesResponse.status()})`,
      ).toContain(variablesResponse.status());
      expect(await variablesResponse.json()).toMatchObject({ error: expect.any(String) });

      // Organization-scoped enumeration must be denied as well.
      const organizationResponse = await outsider.get('/api/projects', {
        params: { organizationId: ownerOrganizationId },
      });
      expect(
        organizationResponse.status(),
        'outsider must not enumerate another organization\'s projects',
      ).toBe(403);

      // Nor may the outsider switch their session into the other tenant.
      const switchResponse = await outsider.post('/api/projects/switch', {
        data: { projectId: ownerProjectId },
      });
      expect(
        [400, 403, 404],
        `outsider must not switch into another tenant's project (got ${switchResponse.status()})`,
      ).toContain(switchResponse.status());

      // Finally, the outsider's own project list must not contain the resource.
      const ownProjects = (await (await outsider.get('/api/projects')).json()) as {
        data?: Array<{ id?: string }>;
      };
      const visibleIds = (ownProjects.data ?? []).map((project) => project.id);
      expect(visibleIds).not.toContain(ownerProjectId);
    } finally {
      await outsider.dispose();
    }
  });
});
