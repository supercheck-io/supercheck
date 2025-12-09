import { test as base, Page, BrowserContext } from "@playwright/test";
import { SignInPage } from "../pages/auth";
import { env, routes } from "../utils/env";

/**
 * Role-Based Test Fixtures
 *
 * Provides authenticated page contexts for each of the 6 RBAC roles:
 * - Super Admin: Full system access
 * - Org Owner: Full organization access
 * - Org Admin: Organization administration
 * - Project Admin: Project-level administration
 * - Editor: Can create and modify resources
 * - Viewer: Read-only access
 *
 * Each fixture creates an authenticated page with the specified role's session.
 */

/**
 * Available roles in the system
 */
export const Role = {
  SuperAdmin: "super_admin",
  OrgOwner: "org_owner",
  OrgAdmin: "org_admin",
  ProjectAdmin: "project_admin",
  Editor: "editor",
  Viewer: "viewer",
} as const;

export type RoleType = (typeof Role)[keyof typeof Role];

// Define role fixture types
type RoleFixtures = {
  // Role-specific authenticated pages
  superAdminPage: Page;
  orgOwnerPage: Page;
  orgAdminPage: Page;
  projectAdminPage: Page;
  editorPage: Page;
  viewerPage: Page;

  // Helper to get page for any role
  getPageForRole: (role: RoleType) => Promise<Page>;
};

/**
 * Helper function to authenticate with a specific role
 * @param browser - Browser instance
 * @param email - User email
 * @param password - User password
 * @param storageStateFile - File to load/save auth state
 */
async function authenticateWithRole(
  browser: import("@playwright/test").Browser,
  email: string,
  password: string,
  storageStateFile: string
): Promise<Page> {
  // Try to use existing auth state first
  try {
    const context = await browser.newContext({
      storageState: storageStateFile,
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check if still authenticated
    if (!page.url().includes("/sign-in")) {
      return page;
    }

    // Auth state expired, close and re-authenticate
    await context.close();
  } catch {
    // Storage state file doesn't exist, continue to authenticate
  }

  // Create fresh context and authenticate
  const context = await browser.newContext();
  const page = await context.newPage();
  const signInPage = new SignInPage(page);

  await signInPage.navigate();
  await signInPage.signInAndWaitForDashboard(email, password);

  // Save auth state for future use
  await context.storageState({ path: storageStateFile });

  return page;
}

/**
 * Extended test with role-based fixtures
 */
export const test = base.extend<RoleFixtures>({
  // Super Admin page
  superAdminPage: async ({ browser }, use) => {
    const superAdmin = env.rbacUsers.superAdmin;
    if (!superAdmin.email || !superAdmin.password) {
      throw new Error(
        "Super admin credentials not configured. Set E2E_SUPER_ADMIN_EMAIL and E2E_SUPER_ADMIN_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      superAdmin.email,
      superAdmin.password,
      "super-admin-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Org Owner page
  orgOwnerPage: async ({ browser }, use) => {
    const credentials = env.rbacUsers.orgOwner;
    if (!credentials.email || !credentials.password) {
      throw new Error(
        "Org owner credentials not configured. Set E2E_ORG_OWNER_EMAIL and E2E_ORG_OWNER_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      credentials.email,
      credentials.password,
      "org-owner-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Org Admin page
  orgAdminPage: async ({ browser }, use) => {
    const credentials = env.rbacUsers.orgAdmin;
    if (!credentials.email || !credentials.password) {
      throw new Error(
        "Org admin credentials not configured. Set E2E_ORG_ADMIN_EMAIL and E2E_ORG_ADMIN_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      credentials.email,
      credentials.password,
      "org-admin-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Project Admin page
  projectAdminPage: async ({ browser }, use) => {
    const credentials = env.rbacUsers.projectAdmin;
    if (!credentials.email || !credentials.password) {
      throw new Error(
        "Project admin credentials not configured. Set E2E_PROJECT_ADMIN_EMAIL and E2E_PROJECT_ADMIN_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      credentials.email,
      credentials.password,
      "project-admin-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Editor page
  editorPage: async ({ browser }, use) => {
    const credentials = env.rbacUsers.editor;
    if (!credentials.email || !credentials.password) {
      throw new Error(
        "Editor credentials not configured. Set E2E_EDITOR_EMAIL and E2E_EDITOR_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      credentials.email,
      credentials.password,
      "editor-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Viewer page
  viewerPage: async ({ browser }, use) => {
    const credentials = env.rbacUsers.viewer;
    if (!credentials.email || !credentials.password) {
      throw new Error(
        "Viewer credentials not configured. Set E2E_VIEWER_EMAIL and E2E_VIEWER_PASSWORD."
      );
    }

    const page = await authenticateWithRole(
      browser,
      credentials.email,
      credentials.password,
      "viewer-auth-state.json"
    );

    await use(page);
    await page.context().close();
  },

  // Helper to get page for any role
  getPageForRole: async ({ browser }, use) => {
    const pages: Map<RoleType, Page> = new Map();

    const getPage = async (role: RoleType): Promise<Page> => {
      // Return cached page if exists
      if (pages.has(role)) {
        return pages.get(role)!;
      }

      let credentials: { email: string; password: string };
      let storageFile: string;

      switch (role) {
        case Role.SuperAdmin:
          credentials = env.rbacUsers.superAdmin;
          storageFile = "super-admin-auth-state.json";
          break;
        case Role.OrgOwner:
          credentials = env.rbacUsers.orgOwner;
          storageFile = "org-owner-auth-state.json";
          break;
        case Role.OrgAdmin:
          credentials = env.rbacUsers.orgAdmin;
          storageFile = "org-admin-auth-state.json";
          break;
        case Role.ProjectAdmin:
          credentials = env.rbacUsers.projectAdmin;
          storageFile = "project-admin-auth-state.json";
          break;
        case Role.Editor:
          credentials = env.rbacUsers.editor;
          storageFile = "editor-auth-state.json";
          break;
        case Role.Viewer:
          credentials = env.rbacUsers.viewer;
          storageFile = "viewer-auth-state.json";
          break;
        default:
          throw new Error(`Unknown role: ${role}`);
      }

      if (!credentials.email || !credentials.password) {
        throw new Error(`Credentials not configured for role: ${role}`);
      }

      const page = await authenticateWithRole(
        browser,
        credentials.email,
        credentials.password,
        storageFile
      );

      pages.set(role, page);
      return page;
    };

    await use(getPage);

    // Cleanup all pages
    for (const page of pages.values()) {
      await page.context().close();
    }
  },
});

// Re-export expect
export { expect } from "@playwright/test";

/**
 * Helper to check if a role has permission for an action
 * Based on RBAC matrix from the application
 */
export const rolePermissions = {
  [Role.SuperAdmin]: {
    canAccessAdmin: true,
    canManageOrg: true,
    canManageProjects: true,
    canCreateTests: true,
    canEditTests: true,
    canViewTests: true,
    canDeleteTests: true,
  },
  [Role.OrgOwner]: {
    canAccessAdmin: false,
    canManageOrg: true,
    canManageProjects: true,
    canCreateTests: true,
    canEditTests: true,
    canViewTests: true,
    canDeleteTests: true,
  },
  [Role.OrgAdmin]: {
    canAccessAdmin: false,
    canManageOrg: true,
    canManageProjects: true,
    canCreateTests: true,
    canEditTests: true,
    canViewTests: true,
    canDeleteTests: true,
  },
  [Role.ProjectAdmin]: {
    canAccessAdmin: false,
    canManageOrg: false,
    canManageProjects: true,
    canCreateTests: true,
    canEditTests: true,
    canViewTests: true,
    canDeleteTests: true,
  },
  [Role.Editor]: {
    canAccessAdmin: false,
    canManageOrg: false,
    canManageProjects: false,
    canCreateTests: true,
    canEditTests: true,
    canViewTests: true,
    canDeleteTests: false,
  },
  [Role.Viewer]: {
    canAccessAdmin: false,
    canManageOrg: false,
    canManageProjects: false,
    canCreateTests: false,
    canEditTests: false,
    canViewTests: true,
    canDeleteTests: false,
  },
} as const;
