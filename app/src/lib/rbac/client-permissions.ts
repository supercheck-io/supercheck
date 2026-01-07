/**
 * Client-side permission checking utilities for Better Auth RBAC System
 */

import { Role } from "./permissions-client";

/**
 * Check if role has permission to perform action on resource
 */
export function hasPermission(
  role: Role,
  resource: string,
  action: string
): boolean {
  let result: boolean;
  switch (role) {
    case Role.SUPER_ADMIN:
      result = true; // Super admin has all permissions
      break;

    case Role.ORG_OWNER:
      // Owners can do everything except system-level operations
      result = resource !== "system";
      break;

    case Role.ORG_ADMIN:
      // Admins can manage org and projects but not delete org
      if (resource === "organization" && action === "delete") {
        result = false;
      } else {
        result = resource !== "system";
      }
      break;

    case Role.PROJECT_ADMIN:
      // Project admins have full control over assigned projects but limited organization access
      if (
        [
          "test",
          "job",
          "monitor",
          "run",
          "apiKey",
          "notification",
          "tag",
          "status_page",
          "requirement",
        ].includes(resource)
      ) {
        result = true; // Full access to project resources including 'manage' action
      } else if (resource === "project") {
        result = ["view", "manage_members"].includes(action);
      } else if (["organization", "member"].includes(resource)) {
        result = action === "view";
      } else {
        result = false;
      }
      break;

    case Role.PROJECT_EDITOR:
      // Editors can create and edit but cannot delete any resources in assigned projects
      if (["test", "job", "status_page", "requirement"].includes(resource)) {
        result = ["view", "create", "update", "run", "trigger"].includes(
          action
        );
      } else if (resource === "monitor") {
        result = ["view", "create", "update", "manage"].includes(action); // Can manage (pause/resume) monitors
      } else if (resource === "tag") {
        result = ["view", "create", "update"].includes(action); // Cannot delete tags
      } else if (resource === "run") {
        result = ["view", "cancel"].includes(action); // Can cancel runs but not delete
      } else if (resource === "apiKey") {
        result = ["view", "create", "update"].includes(action); // Cannot delete API keys
      } else if (resource === "notification") {
        result = ["create", "update", "view"].includes(action); // Cannot delete notifications
      } else if (["organization", "member", "project"].includes(resource)) {
        result = action === "view";
      } else {
        result = false;
      }
      break;

    case Role.PROJECT_VIEWER:
      // Viewers can only view resources
      result = action === "view";
      break;

    default:
      result = false;
      break;
  }

  return result;
}

/**
 * Check if user can edit jobs
 */
export function canEditJobs(role: Role): boolean {
  return hasPermission(role, "job", "update");
}

/**
 * Check if user can delete jobs
 */
export function canDeleteJobs(role: Role): boolean {
  return hasPermission(role, "job", "delete");
}

/**
 * Check if user can trigger jobs
 */
export function canTriggerJobs(role: Role): boolean {
  return hasPermission(role, "job", "trigger");
}

/**
 * Check if user can create jobs
 */
export function canCreateJobs(role: Role): boolean {
  return hasPermission(role, "job", "create");
}

/**
 * Check if user can edit tests
 */
export function canEditTests(role: Role): boolean {
  return hasPermission(role, "test", "update");
}

/**
 * Check if user can delete tests
 */
export function canDeleteTests(role: Role): boolean {
  return hasPermission(role, "test", "delete");
}

/**
 * Check if user can run tests
 */
export function canRunTests(role: Role): boolean {
  return hasPermission(role, "test", "run");
}

/**
 * Check if user can create tests
 */
export function canCreateTests(role: Role): boolean {
  return hasPermission(role, "test", "create");
}

/**
 * Check if user can edit monitors (includes update and manage actions like pause/resume)
 */
export function canEditMonitors(role: Role): boolean {
  return (
    hasPermission(role, "monitor", "update") ||
    hasPermission(role, "monitor", "manage")
  );
}

/**
 * Check if user can delete monitors
 */
export function canDeleteMonitors(role: Role): boolean {
  return hasPermission(role, "monitor", "delete");
}

/**
 * Check if user can create monitors
 */
export function canCreateMonitors(role: Role): boolean {
  return hasPermission(role, "monitor", "create");
}

/**
 * Check if user can manage organization
 */
export function canManageOrganization(role: Role): boolean {
  return hasPermission(role, "organization", "update");
}

/**
 * Check if user can delete organization
 */
export function canDeleteOrganization(role: Role): boolean {
  return hasPermission(role, "organization", "delete");
}

/**
 * Check if user can invite members
 */
export function canInviteMembers(role: Role): boolean {
  return hasPermission(role, "member", "create");
}

/**
 * Check if user can remove members
 */
export function canRemoveMembers(role: Role): boolean {
  return hasPermission(role, "member", "delete");
}

/**
 * Check if user can manage members
 */
export function canManageMembers(role: Role): boolean {
  return hasPermission(role, "member", "update");
}

/**
 * Check if user can create projects
 */
export function canCreateProjects(role: Role): boolean {
  return hasPermission(role, "project", "create");
}

/**
 * Check if user can delete project
 */
export function canDeleteProject(role: Role): boolean {
  return hasPermission(role, "project", "delete");
}

/**
 * Check if user can manage project
 */
export function canManageProject(role: Role): boolean {
  return hasPermission(role, "project", "update");
}

/**
 * Check if user can view API keys
 */
export function canViewAPIKeys(role: Role): boolean {
  return hasPermission(role, "apiKey", "view");
}

/**
 * Check if user can manage API keys
 */
export function canManageAPIKeys(role: Role): boolean {
  return hasPermission(role, "apiKey", "create");
}

/**
 * Check if user can delete runs
 */
export function canDeleteRuns(role: Role): boolean {
  return hasPermission(role, "run", "delete");
}

/**
 * Check if user can cancel running executions
 * Editors and above can cancel runs (anyone who can trigger jobs/tests)
 */
export function canCancelRuns(role: Role): boolean {
  return hasPermission(role, "run", "cancel");
}

/**
 * Check if user can manage runs (delete, export)
 */
export function canManageRuns(role: Role): boolean {
  return (
    hasPermission(role, "run", "delete") || hasPermission(role, "run", "export")
  );
}

/**
 * Check if user can export results
 */
export function canExportResults(role: Role): boolean {
  return hasPermission(role, "run", "export");
}

/**
 * Check if user can create tags
 */
export function canCreateTags(role: Role): boolean {
  return hasPermission(role, "tag", "create");
}

/**
 * Check if user can delete tags
 */
export function canDeleteTags(role: Role): boolean {
  return hasPermission(role, "tag", "delete");
}

/**
 * Check if user can create notification channels
 */
export function canCreateNotifications(role: Role): boolean {
  return hasPermission(role, "notification", "create");
}

/**
 * Check if user can manage notification channels
 */
export function canManageNotifications(role: Role): boolean {
  return (
    hasPermission(role, "notification", "update") ||
    hasPermission(role, "notification", "delete")
  );
}

/**
 * Check if role has organization-wide access
 */
export function hasOrganizationWideAccess(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_VIEWER,
  ].includes(role);
}

/**
 * Check if role is limited to assigned projects
 */
export function isProjectLimitedRole(role: Role): boolean {
  return [Role.PROJECT_ADMIN, Role.PROJECT_EDITOR].includes(role);
}

/**
 * Check if role can edit resources
 */
export function canEditResources(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_ADMIN,
    Role.PROJECT_EDITOR,
  ].includes(role);
}

/**
 * Check if role can delete resources
 */
export function canDeleteResources(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_ADMIN,
  ].includes(role);
}

/**
 * Check if role can delete resources they created (PROJECT_EDITOR excluded)
 */
export function canDeleteOwnResources(role: Role): boolean {
  return [
    Role.SUPER_ADMIN,
    Role.ORG_OWNER,
    Role.ORG_ADMIN,
    Role.PROJECT_ADMIN,
  ].includes(role);
}

/**
 * Context-aware permission checking for client-side use
 */
export interface ClientPermissionContext {
  userId: string;
  role: Role;
  resourceCreatorId?: string;
  isAssignedProject?: boolean;
}

/**
 * Check if user can delete a specific resource considering ownership
 */
export function canDeleteResource(
  context: ClientPermissionContext,
   
  _resource: keyof typeof import("./permissions").statement
): boolean {
  const { role } = context;

  // Super admin, org owner, org admin can delete anything
  if ([Role.SUPER_ADMIN, Role.ORG_OWNER, Role.ORG_ADMIN].includes(role)) {
    return true;
  }

  // Project admin can delete all resources in assigned projects
  if (role === Role.PROJECT_ADMIN && context.isAssignedProject) {
    return true;
  }

  // Project editor cannot delete any resources (removed delete permissions)
  // This section is intentionally left empty as PROJECT_EDITOR no longer has delete access

  return false;
}

/**
 * Check if user can create status pages
 */
export function canCreateStatusPages(role: Role): boolean {
  return hasPermission(role, "status_page", "create");
}

/**
 * Check if user can edit status pages
 */
export function canEditStatusPages(role: Role): boolean {
  return hasPermission(role, "status_page", "update");
}

/**
 * Check if user can delete status pages
 */
export function canDeleteStatusPages(role: Role): boolean {
  return hasPermission(role, "status_page", "delete");
}

/**
 * Check if user can manage status pages
 */
export function canManageStatusPages(role: Role): boolean {
  return (
    hasPermission(role, "status_page", "update") ||
    hasPermission(role, "status_page", "delete")
  );
}

/**
 * Check if user can create requirements
 */
export function canCreateRequirements(role: Role): boolean {
  return hasPermission(role, "requirement", "create");
}

/**
 * Check if user can edit requirements
 */
export function canEditRequirements(role: Role): boolean {
  return hasPermission(role, "requirement", "update");
}

/**
 * Check if user can delete requirements
 */
export function canDeleteRequirements(role: Role): boolean {
  return hasPermission(role, "requirement", "delete");
}
