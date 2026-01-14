import { useQuery, useQueryClient, useIsRestoring } from "@tanstack/react-query";

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

export function useImpersonationStatus() {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  
  const { data, isPending, isFetching, error } = useQuery({
    queryKey: IMPERSONATION_STATUS_QUERY_KEY,
    queryFn: fetchImpersonationStatus,
    // Uses global defaults: staleTime (30min), gcTime (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Function to invalidate cache when impersonation starts/stops
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: IMPERSONATION_STATUS_QUERY_KEY, refetchType: 'all' });
  };

  // Only show loading when actually fetching initial data, not when cache is being restored
  const isInitialLoading = isPending && isFetching && !isRestoring;

  return {
    isImpersonating: data?.isImpersonating ?? false,
    impersonatedUser: data?.impersonatedUser,
    isLoading: isInitialLoading,
    error: error as Error | null,
    invalidate,
  };
}
