import { useQuery, useQueryClient, useIsRestoring } from "@tanstack/react-query";
import { useShellBootstrap } from "@/components/shell-bootstrap";
import { seededQueryOptions } from "@/lib/query-seed";

export interface ImpersonationInfo {
  isImpersonating: boolean;
  impersonatedUser?: {
    id: string;
    name: string;
    email: string;
  };
}

export const IMPERSONATION_STATUS_QUERY_KEY = ["impersonation-status"] as const;

async function fetchImpersonationStatus(): Promise<ImpersonationInfo> {
  const response = await fetch('/api/auth/impersonation-status');
  if (!response.ok) {
    // If not authenticated or error, assume not impersonating
    return { isImpersonating: false };
  }
  return response.json();
}

/** `enabled: false` skips the request (for callers that only need it in some states). */
export function useImpersonationStatus({ enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const bootstrap = useShellBootstrap();

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: IMPERSONATION_STATUS_QUERY_KEY,
    queryFn: fetchImpersonationStatus,
    enabled,
    // Security-sensitive: without a layout value for this user, refetch on every mount. A layout value is
    // fresh for this page load only (see useShellBootstrap, which drops it if the user changes).
    staleTime: 0,
    gcTime: 5 * 60 * 1000, // 5 minutes - short cache for security
    refetchOnWindowFocus: false,
    refetchOnMount: "always", // Always refetch on mount to catch impersonation state changes
    refetchOnReconnect: false,
    retry: 1,
    // Never saved to localStorage: each full page load gets it fresh from the server layout.
    meta: { persist: false },
    // The server layout read it for this page load, so the load itself makes no request.
    ...seededQueryOptions<ImpersonationInfo>(
      bootstrap?.impersonation
        ? { isImpersonating: bootstrap.impersonation.isImpersonating, impersonatedUser: bootstrap.impersonation.impersonatedUser ?? undefined }
        : undefined,
      bootstrap?.readAt,
    ),
  });

  // Function to invalidate cache when impersonation starts/stops
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: IMPERSONATION_STATUS_QUERY_KEY, refetchType: 'all' });
  };

  // Only show loading when actually fetching initial data, not when cache is being restored
  const isInitialLoading = isPending && isFetching && !isRestoring;

  return {
    isImpersonating: data?.isImpersonating ?? false,
    /** True once the status is known; callers that must fail closed wait for it. */
    isKnown: data !== undefined,
    impersonatedUser: data?.impersonatedUser,
    isLoading: isInitialLoading,
    error: error as Error | null,
    invalidate,
  };
}
