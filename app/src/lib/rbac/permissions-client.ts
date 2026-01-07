/**
 * Client-safe RBAC (Role-Based Access Control) Types and Constants
 *
 * This module contains only the client-safe parts of the RBAC system.
 * It does NOT import any server-only dependencies like better-auth/plugins/access.
 *
 * For the full server-side RBAC implementation with Better Auth integration,
 * see permissions.ts (server-only).
 */

// Role names (used in database) - client safe
export enum Role {
  SUPER_ADMIN = "super_admin",
  ORG_OWNER = "org_owner",
  ORG_ADMIN = "org_admin",
  PROJECT_ADMIN = "project_admin",
  PROJECT_EDITOR = "project_editor",
  PROJECT_VIEWER = "project_viewer",
}

// Better Auth statements object defining resources and actions - client safe for reference
export const statement = {
  // System-level resources (SUPER_ADMIN only)
  system: [
    "manage_users",
    "view_users",
    "impersonate_users",
    "manage_organizations",
    "view_organizations",
    "delete_organizations",
    "view_stats",
    "manage_settings",
    "view_audit_logs",
  ],

  // Organization resources
  organization: ["create", "update", "delete", "view"],
  member: ["create", "update", "delete", "view"],
  invitation: ["create", "cancel", "view"],

  // Project-level resources
  project: ["create", "update", "delete", "view", "manage_members"],
  test: ["create", "update", "delete", "view", "run"],
  job: ["create", "update", "delete", "view", "trigger"],
  monitor: ["create", "update", "delete", "view", "manage"],
  status_page: ["create", "update", "delete", "view"],
  run: ["view", "delete", "export", "cancel"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
  requirement: ["create", "update", "delete", "view"],
} as const;

// Role permissions as plain objects (client-safe, no Better Auth dependency)
// These mirror the Better Auth roles but are usable on the client
export const rolePermissions = {
  [Role.SUPER_ADMIN]: {
    system: [
      "manage_users",
      "view_users",
      "impersonate_users",
      "manage_organizations",
      "view_organizations",
      "delete_organizations",
      "view_stats",
      "manage_settings",
      "view_audit_logs",
    ],
    organization: ["create", "update", "delete", "view"],
    member: ["create", "update", "delete", "view"],
    invitation: ["create", "cancel", "view"],
    project: ["create", "update", "delete", "view", "manage_members"],
    test: ["create", "update", "delete", "view", "run"],
    job: ["create", "update", "delete", "view", "trigger"],
    monitor: ["create", "update", "delete", "view", "manage"],
    status_page: ["create", "update", "delete", "view"],
    run: ["view", "delete", "export", "cancel"],
    apiKey: ["create", "update", "delete", "view"],
    notification: ["create", "update", "delete", "view"],
    tag: ["create", "update", "delete", "view"],
    variable: ["create", "update", "delete", "view", "view_secrets"],
    requirement: ["create", "update", "delete", "view"],
  },
  [Role.ORG_OWNER]: {
    system: [],
    organization: ["create", "update", "delete", "view"],
    member: ["create", "update", "delete", "view"],
    invitation: ["create", "cancel", "view"],
    project: ["create", "update", "delete", "view", "manage_members"],
    test: ["create", "update", "delete", "view", "run"],
    job: ["create", "update", "delete", "view", "trigger"],
    monitor: ["create", "update", "delete", "view", "manage"],
    status_page: ["create", "update", "delete", "view"],
    run: ["view", "delete", "export", "cancel"],
    apiKey: ["create", "update", "delete", "view"],
    notification: ["create", "update", "delete", "view"],
    tag: ["create", "update", "delete", "view"],
    variable: ["create", "update", "delete", "view", "view_secrets"],
    requirement: ["create", "update", "delete", "view"],
  },
  [Role.ORG_ADMIN]: {
    system: [],
    organization: ["update", "view"],
    member: ["create", "update", "delete", "view"],
    invitation: ["create", "cancel", "view"],
    project: ["create", "update", "delete", "view", "manage_members"],
    test: ["create", "update", "delete", "view", "run"],
    job: ["create", "update", "delete", "view", "trigger"],
    monitor: ["create", "update", "delete", "view", "manage"],
    status_page: ["create", "update", "delete", "view"],
    run: ["view", "delete", "export", "cancel"],
    apiKey: ["create", "update", "delete", "view"],
    notification: ["create", "update", "delete", "view"],
    tag: ["create", "update", "delete", "view"],
    variable: ["create", "update", "delete", "view", "view_secrets"],
    requirement: ["create", "update", "delete", "view"],
  },
  [Role.PROJECT_ADMIN]: {
    system: [],
    organization: ["view"],
    member: ["view"],
    invitation: ["view"],
    project: ["view", "manage_members"],
    test: ["create", "update", "delete", "view", "run"],
    job: ["create", "update", "delete", "view", "trigger"],
    monitor: ["create", "update", "delete", "view", "manage"],
    status_page: ["create", "update", "delete", "view"],
    run: ["view", "delete", "export", "cancel"],
    apiKey: ["create", "update", "delete", "view"],
    notification: ["create", "update", "delete", "view"],
    tag: ["create", "update", "delete", "view"],
    variable: ["create", "update", "delete", "view", "view_secrets"],
    requirement: ["create", "update", "delete", "view"],
  },
  [Role.PROJECT_EDITOR]: {
    system: [],
    organization: ["view"],
    member: ["view"],
    invitation: ["view"],
    project: ["view"],
    test: ["create", "update", "view", "run"],
    job: ["create", "update", "view", "trigger"],
    monitor: ["create", "update", "view", "manage"],
    status_page: ["create", "update", "view"],
    run: ["view", "cancel"],
    apiKey: ["create", "update", "view"],
    notification: ["create", "update", "view"],
    tag: ["view", "create", "update"],
    variable: ["create", "update", "view", "view_secrets"],
    requirement: ["create", "update", "view"],
  },
  [Role.PROJECT_VIEWER]: {
    system: [],
    organization: ["view"],
    member: ["view"],
    invitation: ["view"],
    project: ["view"],
    test: ["view"],
    job: ["view"],
    monitor: ["view"],
    status_page: ["view"],
    run: ["view"],
    apiKey: [],
    notification: ["view"],
    tag: ["view"],
    variable: ["view"],
    requirement: ["view"],
  },
} as const;

/**
 * Check if role has organization-wide access (can view all projects in the org).
 * 
 * This function determines whether a user can access ALL projects in their organization
 * without needing explicit project assignment:
 * 
 * - SUPER_ADMIN, ORG_OWNER, ORG_ADMIN: Full org-wide access
 * - PROJECT_VIEWER: Read-only access to all projects (intentionally included)
 * - PROJECT_ADMIN, PROJECT_EDITOR: Limited to assigned projects only
 * 
 * Note: PROJECT_VIEWER having org-wide access is intentional - they are granted
 * read-only visibility across all projects to enable monitoring/oversight roles.
 * PROJECT_ADMIN and PROJECT_EDITOR are project-limited because they have edit
 * permissions that should be scoped to their assigned projects.
 */
export function hasOrganizationWideAccess(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_VIEWER,
  ].includes(role);
}

// Helper function to check if role is limited to assigned projects
export function isProjectLimitedRole(role: Role): boolean {
  return [Role.PROJECT_ADMIN, Role.PROJECT_EDITOR].includes(role);
}

// Helper function to check if role can edit resources
export function canEditResources(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_ADMIN,
    Role.PROJECT_EDITOR,
  ].includes(role);
}

// Helper function to check if role can delete resources
export function canDeleteResources(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_ADMIN,
  ].includes(role);
}

// Client-safe permission check (for UI purposes)
export function checkRolePermissionsClient(
  role: string,
  permissions: Record<string, string[]>
): boolean {
  const rolePerms = rolePermissions[role as Role];
  if (!rolePerms) {
    return false;
  }

  for (const [resource, actions] of Object.entries(permissions)) {
    const roleActions =
      (rolePerms as Record<string, readonly string[]>)[resource] || [];

    for (const action of actions) {
      if (!roleActions.includes(action)) {
        return false;
      }
    }
  }

  return true;
}
