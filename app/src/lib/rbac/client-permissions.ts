/**
 * Client-side permission checking utilities for the Better Auth RBAC system.
 *
 * The authoritative permission matrix lives in `permissions-client.ts`
 * (`rolePermissions`), which is kept in lock-step with the server-side Better
 * Auth roles in `permissions.ts`. Everything here delegates to that matrix so
 * the UI can never drift from what the server enforces.
 *
 * `client-permissions.spec.ts` pins the helper behaviour and verifies the
 * matrix parity against the server statements.
 */

import { Role, checkRolePermissionsClient } from "./permissions-client";

// Re-export the shared role-scope helpers so components can keep importing
// them from a single client-permissions entry point.
export {
  hasOrganizationWideAccess,
  isProjectLimitedRole,
  canEditResources,
  canDeleteResources,
} from "./permissions-client";

/**
 * Check if role has permission to perform action on resource.
 *
 * Super admins bypass the matrix entirely (they hold every permission, even
 * for resources that are not part of the statement definitions).
 */
export function hasPermission(
  role: Role,
  resource: string,
  action: string
): boolean {
  if (role === Role.SUPER_ADMIN) {
    return true; // Super admin has all permissions
  }

  return checkRolePermissionsClient(role, { [resource]: [action] });
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

export function canInvestigateSre(role: Role): boolean {
  return hasPermission(role, "sre_investigation", "investigate");
}

export function canUseSreLiveConnectorTools(role: Role): boolean {
  return hasPermission(role, "sre_connector", "investigate");
}
