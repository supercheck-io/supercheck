import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  
  const { data, isLoading, error } = useQuery({
    queryKey: IMPERSONATION_STATUS_QUERY_KEY,
    queryFn: fetchImpersonationStatus,
    staleTime: 60 * 1000,
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
