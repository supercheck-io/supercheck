/**
 * Comprehensive Role Normalization System
 *
 * This module provides a single source of truth for role format conversion
 * and handles all the inconsistencies in the RBAC system.
 */

import { Role } from "./permissions";

/**
 * New RBAC role string formats ONLY
 */
export type RoleStringVariant =
  | "super_admin"
  | "org_owner"
  | "org_admin"
  | "project_admin"
  | "project_editor"
  | "project_viewer"
  | string;

/**
 * Comprehensive role normalization that handles ALL format variations
 */
export function normalizeRole(
  roleInput: RoleStringVariant | Role | null | undefined
): Role {
  if (!roleInput) {
    return Role.PROJECT_VIEWER; // Safe default
  }

  // If already a Role enum, return as-is
  if (Object.values(Role).includes(roleInput as Role)) {
    return roleInput as Role;
  }

  // Normalize string input to lowercase for consistent matching
  const roleString = String(roleInput).toLowerCase().trim();

  switch (roleString) {
    case "super_admin":
      return Role.SUPER_ADMIN;
    case "org_owner":
      return Role.ORG_OWNER;
    case "org_admin":
      return Role.ORG_ADMIN;
    case "project_admin":
      return Role.PROJECT_ADMIN;
    case "project_editor":
      return Role.PROJECT_EDITOR;
    case "project_viewer":
      return Role.PROJECT_VIEWER;

    default:
      console.warn(
        `[RoleNormalizer] Unknown role format: "${roleInput}", defaulting to PROJECT_VIEWER`
      );
      return Role.PROJECT_VIEWER; // Safe default
  }
}

/**
 * Convert Role enum to standardized string format for database storage
 */
export function roleToString(role: Role): string {
  switch (role) {
    case Role.SUPER_ADMIN:
      return "super_admin";
    case Role.ORG_OWNER:
      return "org_owner";
    case Role.ORG_ADMIN:
      return "org_admin";
    case Role.PROJECT_ADMIN:
      return "project_admin";
    case Role.PROJECT_EDITOR:
      return "project_editor";
    case Role.PROJECT_VIEWER:
      return "project_viewer";
    default:
      console.warn(
        `[RoleNormalizer] Unknown role enum: "${role}", defaulting to project_viewer`
      );
      return "project_viewer";
  }
}

/**
 * Convert Role enum to display-friendly format
 */
export function roleToDisplayName(role: Role): string {
  switch (role) {
    case Role.SUPER_ADMIN:
      return "Super Admin";
    case Role.ORG_OWNER:
      return "Organization Owner";
    case Role.ORG_ADMIN:
      return "Organization Admin";
    case Role.PROJECT_ADMIN:
      return "Project Admin";
    case Role.PROJECT_EDITOR:
      return "Project Editor";
    case Role.PROJECT_VIEWER:
      return "Project Viewer";
    default:
      return "Project Viewer";
  }
}

/**
 * Check if a role string needs normalization
 */
export function isNormalizedRole(roleString: string): boolean {
  return [
    "super_admin",
    "org_owner",
    "org_admin",
    "project_admin",
    "project_editor",
    "project_viewer",
  ].includes(roleString);
}

/**
 * Get role hierarchy level (higher number = more permissions)
 */
export function getRoleHierarchyLevel(role: Role): number {
  switch (role) {
    case Role.SUPER_ADMIN:
      return 6;
    case Role.ORG_OWNER:
      return 5;
    case Role.ORG_ADMIN:
      return 4;
    case Role.PROJECT_ADMIN:
      return 3;
    case Role.PROJECT_EDITOR:
      return 2;
    case Role.PROJECT_VIEWER:
      return 1;
    default:
      return 0;
  }
}

/**
 * Compare roles and return the higher one
 */
export function getHigherRole(role1: Role, role2: Role): Role {
  return getRoleHierarchyLevel(role1) >= getRoleHierarchyLevel(role2)
    ? role1
    : role2;
}

/**
 * Batch normalize roles (useful for processing multiple roles)
 */
export function normalizeRoles(
  roles: (RoleStringVariant | null | undefined)[]
): Role[] {
  return roles.map(normalizeRole);
}

/**
 * Find the highest role from a list of role strings
 */
export function findHighestRole(
  roles: (RoleStringVariant | null | undefined)[]
): Role {
  const normalizedRoles = normalizeRoles(roles);
  return normalizedRoles.reduce(
    (highest, current) => getHigherRole(highest, current),
    Role.PROJECT_VIEWER
  );
}

/**
 * Validation function to ensure role is valid
 */
export function isValidRole(role: unknown): role is Role {
  return Object.values(Role).includes(role as Role);
}

/**
 * Debug utility to log role conversion for troubleshooting
 */
export function debugRoleConversion(
  originalRole: unknown,
  context: string = ""
): Role {
  const normalizedRole = normalizeRole(
    originalRole as RoleStringVariant | Role | null | undefined
  );
  console.log(
    `[RoleNormalizer] ${
      context ? `${context}: ` : ""
    }${originalRole} → ${normalizedRole}`
  );
  return normalizedRole;
}
