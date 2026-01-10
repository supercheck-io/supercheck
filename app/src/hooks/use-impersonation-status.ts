/**
 * Impersonation Status Hook
 * 
 * Checks if the current user is impersonating another user.
 * Uses React Query for efficient caching - status is fetched once per session.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================================================
// TYPES
// ============================================================================

export interface ImpersonationInfo {
  isImpersonating: boolean;
  impersonatedUser?: {
    id: string;
    name: string;
    email: string;
  };
}

// ============================================================================
// QUERY KEY (exported for cache invalidation)
// ============================================================================

export const IMPERSONATION_STATUS_QUERY_KEY = ["impersonation-status"] as const;

// ============================================================================
// FETCH FUNCTION
// ============================================================================

async function fetchImpersonationStatus(): Promise<ImpersonationInfo> {
  const response = await fetch('/api/auth/impersonation-status');
  if (!response.ok) {
    // If not authenticated or error, assume not impersonating
    return { isImpersonating: false };
  }
  return response.json();
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to check impersonation status
 * 
 * Uses React Query for caching. Most users are not impersonating,
 * so we cache this to avoid repeated calls.
 */
export function useImpersonationStatus() {
  const queryClient = useQueryClient();
  
  const { data, isLoading, error } = useQuery({
    queryKey: IMPERSONATION_STATUS_QUERY_KEY,
    queryFn: fetchImpersonationStatus,
    staleTime: 60 * 1000,     // 1 minute - needs to be responsive to changes
    // gcTime inherited (24h) for session-long caching
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  // Function to invalidate cache when impersonation starts/stops
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: IMPERSONATION_STATUS_QUERY_KEY, refetchType: 'all' });
  };

  return {
    isImpersonating: data?.isImpersonating ?? false,
    impersonatedUser: data?.impersonatedUser,
    isLoading,
    error: error as Error | null,
    invalidate,
  };
}
