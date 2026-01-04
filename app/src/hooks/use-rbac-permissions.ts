/**
 * Unified RBAC Permission Hook
 *
 * This hook provides a single, consistent way to check permissions across all UI components.
 * It replaces the scattered permission checking logic throughout the codebase.
 */

import { useMemo } from "react";
import { useProjectContext } from "./use-project-context";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import {
  canCreateTests,
  canEditTests,
  canDeleteTests,
  canRunTests,
  canCreateJobs,
  canEditJobs,
  canDeleteJobs,
  canTriggerJobs,
  canCreateMonitors,
  canEditMonitors,
  canDeleteMonitors,
  canManageOrganization,
  canDeleteOrganization,
  canInviteMembers,
  canRemoveMembers,
  canManageMembers,
  canCreateProjects,
  canDeleteProject,
  canManageProject,
  canViewAPIKeys,
  canManageAPIKeys,
  canExportResults,
  canCreateRequirements,
  canEditRequirements,
  canDeleteRequirements,
} from "@/lib/rbac/client-permissions";
import { Role } from "@/lib/rbac/permissions-client";

export interface RBACPermissions {
  // Test permissions
  canCreateTest: boolean;
  canEditTest: boolean;
  canDeleteTest: boolean;
  canRunTest: boolean;

  // Job permissions
  canCreateJob: boolean;
  canEditJob: boolean;
  canDeleteJob: boolean;
  canTriggerJob: boolean;

  // Monitor permissions
  canCreateMonitor: boolean;
  canEditMonitor: boolean;
  canDeleteMonitor: boolean;

  // Organization permissions
  canManageOrg: boolean;
  canDeleteOrg: boolean;

  // Member permissions
  canInviteMember: boolean;
  canRemoveMember: boolean;
  canManageMember: boolean;

  // Project permissions
  canCreateProject: boolean;
  canDeleteProject: boolean;
  canManageProject: boolean;

  // API Key permissions
  canViewAPIKey: boolean;
  canManageAPIKey: boolean;

  // Export permissions
  canExportResult: boolean;

  // Requirement permissions
  canCreateRequirement: boolean;
  canEditRequirement: boolean;
  canDeleteRequirement: boolean;

  // Role info
  userRole: Role | null;
  userRoleString: string | null;
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Main RBAC permission hook
 */
export function useRBACPermissions(): RBACPermissions {
  const { currentProject, loading, error } = useProjectContext();

  const permissions = useMemo(() => {
    if (loading) {
      return {
        canCreateTest: false,
        canEditTest: false,
        canDeleteTest: false,
        canRunTest: false,
        canCreateJob: false,
        canEditJob: false,
        canDeleteJob: false,
        canTriggerJob: false,
        canCreateMonitor: false,
        canEditMonitor: false,
        canDeleteMonitor: false,
        canManageOrg: false,
        canDeleteOrg: false,
        canInviteMember: false,
        canRemoveMember: false,
        canManageMember: false,
        canCreateProject: false,
        canDeleteProject: false,
        canManageProject: false,
        canViewAPIKey: false,
        canManageAPIKey: false,
        canExportResult: false,
        canCreateRequirement: false,
        canEditRequirement: false,
        canDeleteRequirement: false,
        userRole: null,
        userRoleString: null,
        isLoading: true,
        hasError: false,
      };
    }

    if (error || !currentProject?.userRole) {
      return {
        canCreateTest: false,
        canEditTest: false,
        canDeleteTest: false,
        canRunTest: false,
        canCreateJob: false,
        canEditJob: false,
        canDeleteJob: false,
        canTriggerJob: false,
        canCreateMonitor: false,
        canEditMonitor: false,
        canDeleteMonitor: false,
        canManageOrg: false,
        canDeleteOrg: false,
        canInviteMember: false,
        canRemoveMember: false,
        canManageMember: false,
        canCreateProject: false,
        canDeleteProject: false,
        canManageProject: false,
        canViewAPIKey: false,
        canManageAPIKey: false,
        canExportResult: false,
        canCreateRequirement: false,
        canEditRequirement: false,
        canDeleteRequirement: false,
        userRole: null,
        userRoleString: null,
        isLoading: false,
        hasError: true,
      };
    }

    // Normalize the role using our comprehensive normalizer
    const normalizedRole = normalizeRole(currentProject.userRole);

    return {
      // Test permissions
      canCreateTest: canCreateTests(normalizedRole),
      canEditTest: canEditTests(normalizedRole),
      canDeleteTest: canDeleteTests(normalizedRole),
      canRunTest: canRunTests(normalizedRole),

      // Job permissions
      canCreateJob: canCreateJobs(normalizedRole),
      canEditJob: canEditJobs(normalizedRole),
      canDeleteJob: canDeleteJobs(normalizedRole),
      canTriggerJob: canTriggerJobs(normalizedRole),

      // Monitor permissions
      canCreateMonitor: canCreateMonitors(normalizedRole),
      canEditMonitor: canEditMonitors(normalizedRole),
      canDeleteMonitor: canDeleteMonitors(normalizedRole),

      // Organization permissions
      canManageOrg: canManageOrganization(normalizedRole),
      canDeleteOrg: canDeleteOrganization(normalizedRole),

      // Member permissions
      canInviteMember: canInviteMembers(normalizedRole),
      canRemoveMember: canRemoveMembers(normalizedRole),
      canManageMember: canManageMembers(normalizedRole),

      // Project permissions
      canCreateProject: canCreateProjects(normalizedRole),
      canDeleteProject: canDeleteProject(normalizedRole),
      canManageProject: canManageProject(normalizedRole),

      // API Key permissions
      canViewAPIKey: canViewAPIKeys(normalizedRole),
      canManageAPIKey: canManageAPIKeys(normalizedRole),

      // Export permissions
      canExportResult: canExportResults(normalizedRole),

      // Requirement permissions
      canCreateRequirement: canCreateRequirements(normalizedRole),
      canEditRequirement: canEditRequirements(normalizedRole),
      canDeleteRequirement: canDeleteRequirements(normalizedRole),

      // Role info
      userRole: normalizedRole,
      userRoleString: currentProject.userRole,
      isLoading: false,
      hasError: false,
    };
  }, [currentProject, loading, error]);

  return permissions;
}

/**
 * Specialized hooks for specific permission categories
 */

export function useTestPermissions() {
  const {
    canCreateTest,
    canEditTest,
    canDeleteTest,
    canRunTest,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canCreateTest,
    canEditTest,
    canDeleteTest,
    canRunTest,
    isLoading,
    hasError,
  };
}

export function useJobPermissions() {
  const {
    canCreateJob,
    canEditJob,
    canDeleteJob,
    canTriggerJob,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canCreateJob,
    canEditJob,
    canDeleteJob,
    canTriggerJob,
    isLoading,
    hasError,
  };
}

export function useMonitorPermissions() {
  const {
    canCreateMonitor,
    canEditMonitor,
    canDeleteMonitor,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canCreateMonitor,
    canEditMonitor,
    canDeleteMonitor,
    isLoading,
    hasError,
  };
}

export function useOrganizationPermissions() {
  const {
    canManageOrg,
    canDeleteOrg,
    canInviteMember,
    canRemoveMember,
    canManageMember,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canManageOrg,
    canDeleteOrg,
    canInviteMember,
    canRemoveMember,
    canManageMember,
    isLoading,
    hasError,
  };
}

export function useProjectPermissions() {
  const {
    canCreateProject,
    canDeleteProject,
    canManageProject,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canCreateProject,
    canDeleteProject,
    canManageProject,
    isLoading,
    hasError,
  };
}

export function useRequirementPermissions() {
  const {
    canCreateRequirement,
    canEditRequirement,
    canDeleteRequirement,
    isLoading,
    hasError,
  } = useRBACPermissions();
  return {
    canCreateRequirement,
    canEditRequirement,
    canDeleteRequirement,
    isLoading,
    hasError,
  };
}

/**
 * Debug hook for troubleshooting permission issues
 */
export function useRBACDebug() {
  const { currentProject } = useProjectContext();
  const permissions = useRBACPermissions();

  const debugInfo = useMemo(() => {
    return {
      projectContext: currentProject,
      rawRole: currentProject?.userRole,
      normalizedRole: permissions.userRole,
      allPermissions: permissions,
    };
  }, [currentProject, permissions]);

  // Only log in development
  if (process.env.NODE_ENV === "development") {
    console.log("[RBAC Debug]", debugInfo);
  }

  return debugInfo;
}
