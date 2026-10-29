import { Role } from "./permissions-client";
import { normalizeRole } from "./role-normalizer";

/** Project-scoped roles from lowest to highest. Index = rank; the lower rank wins. */
export const PROJECT_ROLE_ORDER = [
  Role.PROJECT_VIEWER,
  Role.PROJECT_EDITOR,
  Role.PROJECT_ADMIN,
] as const;

const rank = (role: Role) => PROJECT_ROLE_ORDER.indexOf(role as (typeof PROJECT_ROLE_ORDER)[number]);

/**
 * The single place that decides a user's effective role in a project.
 *
 * - No org role: null (not a member; callers deny).
 * - Org owner/admin (and super admin): org role, org-wide bypass of project_members,
 *   so an org owner can never be locked out of their own projects.
 * - Project-scoped org role: the LOWER of the org role and the project_members role.
 *   No project_members row means project_viewer. An unrecognised row role ranks lowest.
 */
export function resolveEffectiveProjectRole(
  orgRole: Role | string | null | undefined,
  projectMemberRole: string | null | undefined,
): Role | null {
  if (!orgRole) return null;
  const org = normalizeRole(orgRole);
  if (rank(org) < 0) return org;
  if (!projectMemberRole) return Role.PROJECT_VIEWER;
  const proj = normalizeRole(projectMemberRole);
  const lower = Math.min(rank(org), Math.max(rank(proj), 0));
  return PROJECT_ROLE_ORDER[lower];
}

/** True when a project_members role would be capped by the org role, so writes can refuse it instead. */
export function projectRoleExceedsOrgRole(orgRole: Role | string, projectRole: string): boolean {
  const org = rank(normalizeRole(orgRole));
  return org >= 0 && rank(normalizeRole(projectRole)) > org;
}
