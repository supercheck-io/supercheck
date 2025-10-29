/**
 * Better Auth RBAC (Role-Based Access Control) System
 *
 * This module integrates with Better Auth's access control system and defines:
 * - Statements: Resources and their available actions
 * - Roles: Permission sets for different user roles
 * - Access Control: Better Auth integration for permission checking
 *
 * Roles:
 * - SUPER_ADMIN: System-wide access to everything
 * - ORG_OWNER: Full organization and all project control
 * - ORG_ADMIN: Organization and all project management (cannot delete org)
 * - PROJECT_EDITOR: Can edit tests, jobs, monitors in assigned projects only
 * - PROJECT_VIEWER: Read-only access to all projects in organization
 */

import { createAccessControl } from "better-auth/plugins/access";

// Better Auth statements object defining resources and actions
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
  run: ["view", "delete", "export"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
} as const;

// Create Better Auth access controller
export const ac = createAccessControl(statement);

// Role names (used in database)
export enum Role {
  SUPER_ADMIN = "super_admin",
  ORG_OWNER = "org_owner",
  ORG_ADMIN = "org_admin",
  PROJECT_ADMIN = "project_admin",
  PROJECT_EDITOR = "project_editor",
  PROJECT_VIEWER = "project_viewer",
}

// SUPER_ADMIN: Full system access
export const superAdmin = ac.newRole({
  // System permissions
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

  // Organization permissions
  organization: ["create", "update", "delete", "view"],
  member: ["create", "update", "delete", "view"],
  invitation: ["create", "cancel", "view"],

  // Full project access
  project: ["create", "update", "delete", "view", "manage_members"],
  test: ["create", "update", "delete", "view", "run"],
  job: ["create", "update", "delete", "view", "trigger"],
  monitor: ["create", "update", "delete", "view", "manage"],
  status_page: ["create", "update", "delete", "view"],
  run: ["view", "delete", "export"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
});

// ORG_OWNER: Full organization control (no system permissions)
export const orgOwner = ac.newRole({
  // No system permissions
  system: [],

  // Organization permissions (including delete)
  organization: ["create", "update", "delete", "view"],
  member: ["create", "update", "delete", "view"],
  invitation: ["create", "cancel", "view"],

  // Full project access
  project: ["create", "update", "delete", "view", "manage_members"],
  test: ["create", "update", "delete", "view", "run"],
  job: ["create", "update", "delete", "view", "trigger"],
  monitor: ["create", "update", "delete", "view", "manage"],
  status_page: ["create", "update", "delete", "view"],
  run: ["view", "delete", "export"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
});

// ORG_ADMIN: Organization management (cannot delete org, no system permissions)
export const orgAdmin = ac.newRole({
  // No system permissions
  system: [],

  // Organization permissions (no delete)
  organization: ["update", "view"],
  member: ["create", "update", "delete", "view"],
  invitation: ["create", "cancel", "view"],

  // Full project access
  project: ["create", "update", "delete", "view", "manage_members"],
  test: ["create", "update", "delete", "view", "run"],
  job: ["create", "update", "delete", "view", "trigger"],
  monitor: ["create", "update", "delete", "view", "manage"],
  status_page: ["create", "update", "delete", "view"],
  run: ["view", "delete", "export"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
});

// PROJECT_ADMIN: Full project management but limited to assigned projects (no system permissions)
export const projectAdmin = ac.newRole({
  // No system permissions
  system: [],

  // Limited organization access
  organization: ["view"],
  member: ["view"],
  invitation: ["view"],

  // Full project admin permissions for assigned projects
  project: ["view", "manage_members"],
  test: ["create", "update", "delete", "view", "run"],
  job: ["create", "update", "delete", "view", "trigger"],
  monitor: ["create", "update", "delete", "view", "manage"],
  status_page: ["create", "update", "delete", "view"],
  run: ["view", "delete", "export"],
  apiKey: ["create", "update", "delete", "view"],
  notification: ["create", "update", "delete", "view"],
  tag: ["create", "update", "delete", "view"],
  variable: ["create", "update", "delete", "view", "view_secrets"],
});

// PROJECT_EDITOR: Can edit assigned projects only (no system permissions)
export const projectEditor = ac.newRole({
  // No system permissions
  system: [],

  // Limited organization access
  organization: ["view"],
  member: ["view"],
  invitation: ["view"],

  // Project editing permissions (cannot delete any resources)
  project: ["view"],
  test: ["create", "update", "view", "run"],
  job: ["create", "update", "view", "trigger"],
  monitor: ["create", "update", "view", "manage"],
  status_page: ["create", "update", "view"],
  run: ["view"],
  apiKey: ["create", "update", "view"],
  notification: ["create", "update", "view"],
  tag: ["view", "create", "update"],
  variable: ["view"],
});

// PROJECT_VIEWER: Read-only access (no system permissions)
export const projectViewer = ac.newRole({
  // No system permissions
  system: [],

  // Read-only organization access
  organization: ["view"],
  member: ["view"],
  invitation: ["view"],

  // Read-only project access
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
});

// Export role mapping for Better Auth integration
export const roles = {
  [Role.SUPER_ADMIN]: superAdmin,
  [Role.ORG_OWNER]: orgOwner,
  [Role.ORG_ADMIN]: orgAdmin,
  [Role.PROJECT_ADMIN]: projectAdmin,
  [Role.PROJECT_EDITOR]: projectEditor,
  [Role.PROJECT_VIEWER]: projectViewer,
};

// Better Auth integration types
export type BetterAuthStatement = typeof statement;
export type BetterAuthRole = typeof superAdmin;

// Utility functions for role-based checks
export function checkRolePermissions(
  role: string,
  permissions: Record<string, string[]>
): boolean {
  const roleInstance = roles[role as Role];
  if (!roleInstance) {
    return false;
  }

  // Use Better Auth's checkRolePermission functionality
  for (const [resource, actions] of Object.entries(permissions)) {
    const roleStatements = roleInstance.statements as Record<string, string[]>;
    const roleActions = roleStatements[resource] || [];

    for (const action of actions) {
      if (!roleActions.includes(action)) {
        return false;
      }
    }
  }

  return true;
}

// Get Better Auth role definition
export function getBetterAuthRole(role: Role): BetterAuthRole | undefined {
  return roles[role];
}

// Helper function to check if role has organization-wide access
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

// Permission context for checking user permissions
export interface PermissionContext {
  userId: string;
  role: Role;
  organizationId?: string;
  projectId?: string;
  assignedProjectIds?: string[]; // For PROJECT_EDITOR role
  resourceCreatorId?: string; // For creator-based permissions
}

// Check if user has permission in context
export function hasPermission(
  context: PermissionContext,
  resource: keyof typeof statement,
  action: string
): boolean {
  const roleInstance = roles[context.role];
  if (!roleInstance) {
    return false;
  }

  // SUPER_ADMIN always has access
  if (context.role === Role.SUPER_ADMIN) {
    return true;
  }

  // Check if role has the specific permission
  const roleStatements = roleInstance.statements as Record<string, string[]>;
  const roleActions = roleStatements[resource] || [];

  if (!roleActions.includes(action)) {
    return false;
  }

  // Special case: PROJECT_ADMIN and PROJECT_EDITOR have viewer access to all projects, but edit access only to assigned projects
  if (
    [Role.PROJECT_ADMIN, Role.PROJECT_EDITOR].includes(context.role) &&
    [
      "project",
      "test",
      "job",
      "monitor",
      "status_page",
      "run",
      "apiKey",
      "notification",
    ].includes(resource) &&
    context.projectId &&
    !context.assignedProjectIds?.includes(context.projectId)
  ) {
    // Allow only view actions for non-assigned projects
    if (!["view"].includes(action)) {
      return false;
    }
  }

  // Special case: For tags, PROJECT_ADMIN and PROJECT_EDITOR can create/delete in assigned projects only
  if (
    [Role.PROJECT_ADMIN, Role.PROJECT_EDITOR].includes(context.role) &&
    resource === "tag" &&
    context.projectId &&
    !context.assignedProjectIds?.includes(context.projectId)
  ) {
    // Allow only view actions for non-assigned projects
    if (!["view"].includes(action)) {
      return false;
    }
  }

  // Special case: PROJECT_EDITOR cannot delete any resources (delete permissions removed)
  if (context.role === Role.PROJECT_EDITOR && action === "delete") {
    return false;
  }

  return true;
}
