/**
 * Better Auth permission checking hooks for React components
 */

import { useState, useEffect, useMemo } from 'react';
import { authClient } from '@/utils/auth-client';
import { useSession } from '@/utils/auth-client';
import { checkRolePermissions } from '@/lib/rbac/permissions';

/**
 * Hook to check if user has specific permissions
 */
export function useHasPermission(permissions: Record<string, string[]>) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { data: session } = useSession();

  const permissionsString = JSON.stringify(permissions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePermissions = useMemo(() => permissions, [permissionsString]);

  useEffect(() => {
    if (!session) {
      setHasPermission(false);
      setIsLoading(false);
      return;
    }

    const checkPermissions = async () => {
      try {
        setIsLoading(true);
        
        // Use Better Auth's hasPermission for organization/admin permissions
        if (stablePermissions.organization || stablePermissions.member || stablePermissions.invitation || stablePermissions.user) {
          const { data, error } = await authClient.organization.hasPermission({
            permissions: stablePermissions
          });
          if (error) {
            console.error('Permission check failed:', error);
            setHasPermission(false);
          } else {
            setHasPermission(!!data);
          }
        } else {
          // For other permissions, assume they have access if authenticated
          // In a real app, you'd implement server-side checks for custom permissions
          setHasPermission(true);
        }
      } catch (error) {
        console.error('Permission check failed:', error);
        setHasPermission(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkPermissions();
  }, [session, stablePermissions]);

  return { hasPermission, isLoading };
}

/**
 * Hook to check organization admin permissions
 */
export function useIsOrgAdmin() {
  return useHasPermission({
    organization: ['update'],
    member: ['create', 'update', 'delete']
  });
}

/**
 * Hook to check system admin permissions
 */
export function useIsSystemAdmin() {
  return useHasPermission({
    user: ['create', 'update', 'delete']
  });
}

/**
 * Hook to check if user can manage projects
 */
export function useCanManageProjects() {
  return useHasPermission({
    organization: ['update']
  });
}

/**
 * Hook to check role-based permissions without server calls
 */
export function useCheckRolePermission(role: string, permissions: Record<string, string[]>) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const permissionsString = JSON.stringify(permissions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePermissions = useMemo(() => permissions, [permissionsString]);

  useEffect(() => {
    // Use client-side role permission checking with our RBAC system
    try {
      const result = checkRolePermissions(role, stablePermissions);
      setHasPermission(result);
    } catch (error) {
      console.error('Role permission check failed:', error);
      setHasPermission(false);
    }
  }, [role, stablePermissions]);

  return hasPermission;
}

/**
 * Simplified hooks for common job/test/monitor permissions
 * These use proper role-based checks
 */
export function useCanEditJobs() {
  const { data: session } = useSession();
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setCanEdit(false);
      return;
    }

    // Get user role from project context and check permissions
    const getUserRole = async () => {
      try {
        const response = await fetch('/api/projects/current');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.project?.userRole) {
            // Use client-side permission checking
            import('@/lib/rbac/client-permissions').then(({ canEditJobs }) => {
              setCanEdit(canEditJobs(data.project.userRole));
            });
          } else {
            setCanEdit(false);
          }
        } else {
          setCanEdit(false);
        }
      } catch (error) {
        console.error('Error checking job edit permissions:', error);
        setCanEdit(false);
      }
    };

    getUserRole();
  }, [session]);

  return canEdit;
}

export function useCanDeleteJobs() {
  const { data: session } = useSession();
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setCanDelete(false);
      return;
    }

    // Get user role from project context and check permissions
    const getUserRole = async () => {
      try {
        const response = await fetch('/api/projects/current');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.project?.userRole) {
            // Use client-side permission checking
            import('@/lib/rbac/client-permissions').then(({ canDeleteJobs }) => {
              setCanDelete(canDeleteJobs(data.project.userRole));
            });
          } else {
            setCanDelete(false);
          }
        } else {
          setCanDelete(false);
        }
      } catch (error) {
        console.error('Error checking job delete permissions:', error);
        setCanDelete(false);
      }
    };

    getUserRole();
  }, [session]);

  return canDelete;
}

export function useCanEditTests() {
  const { data: session } = useSession();
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setCanEdit(false);
      return;
    }

    // Get user role from project context and check permissions
    const getUserRole = async () => {
      try {
        const response = await fetch('/api/projects/current');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.project?.userRole) {
            // Use client-side permission checking
            import('@/lib/rbac/client-permissions').then(({ canEditTests }) => {
              setCanEdit(canEditTests(data.project.userRole));
            });
          } else {
            setCanEdit(false);
          }
        } else {
          setCanEdit(false);
        }
      } catch (error) {
        console.error('Error checking test edit permissions:', error);
        setCanEdit(false);
      }
    };

    getUserRole();
  }, [session]);

  return canEdit;
}

export function useCanDeleteTests() {
  const { data: session } = useSession();
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setCanDelete(false);
      return;
    }

    // Get user role from project context and check permissions
    const getUserRole = async () => {
      try {
        const response = await fetch('/api/projects/current');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.project?.userRole) {
            // Use client-side permission checking
            import('@/lib/rbac/client-permissions').then(({ canDeleteTests }) => {
              setCanDelete(canDeleteTests(data.project.userRole));
            });
          } else {
            setCanDelete(false);
          }
        } else {
          setCanDelete(false);
        }
      } catch (error) {
        console.error('Error checking test delete permissions:', error);
        setCanDelete(false);
      }
    };

    getUserRole();
  }, [session]);

  return canDelete;
}