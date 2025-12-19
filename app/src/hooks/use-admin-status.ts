/**
 * Admin Status Hook
 * 
 * Checks if the current user has admin privileges (super admin or org admin).
 * Uses React Query for efficient caching - status is fetched once and cached
 * for 5 minutes per session.
 */

import { useQuery } from "@tanstack/react-query";

// ============================================================================
// TYPES
// ============================================================================

interface AdminStatus {
  isAdmin: boolean;
  isOrgAdmin: boolean;
}

// ============================================================================
// QUERY KEY (exported for cache invalidation if needed)
// ============================================================================

export const ADMIN_STATUS_QUERY_KEY = ["admin-status"] as const;

// ============================================================================
// FETCH FUNCTION (exported for prefetching)
// ============================================================================

export async function fetchAdminStatus(): Promise<AdminStatus> {
  // Fetch both admin statuses in parallel for efficiency
  const [adminResponse, orgAdminResponse] = await Promise.all([
    fetch("/api/admin/check"),
    fetch("/api/organizations/stats"),
  ]);

  let isAdmin = false;
  let isOrgAdmin = false;

  // Check super admin status
  if (adminResponse.ok) {
    try {
      const data = await adminResponse.json();
      isAdmin = data.isAdmin || false;
    } catch {
      // JSON parse error - assume not admin
    }
  }

  // Check org admin status (200 = org admin, 403 = not org admin)
  isOrgAdmin = orgAdminResponse.status === 200;

  return { isAdmin, isOrgAdmin };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to check admin status (super admin and org admin)
 * 
 * Uses React Query for caching with staleTime of 5 minutes.
 * Admin status rarely changes during a session.
 */
export function useAdminStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ADMIN_STATUS_QUERY_KEY,
    queryFn: fetchAdminStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes - status rarely changes
    gcTime: 10 * 60 * 1000,   // 10 minutes cache
    refetchOnWindowFocus: false,
    refetchOnMount: false,    // Use cached data across components
    refetchOnReconnect: false,
    retry: 1,
  });

  return {
    isAdmin: data?.isAdmin ?? false,
    isOrgAdmin: data?.isOrgAdmin ?? false,
    isLoading,
    error: error as Error | null,
    // Combined check for showing any admin menu
    hasAdminAccess: (data?.isAdmin || data?.isOrgAdmin) ?? false,
  };
}
