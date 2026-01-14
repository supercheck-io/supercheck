import { useQuery, useIsRestoring } from "@tanstack/react-query";

interface AdminStatus {
  isAdmin: boolean;
  isOrgAdmin: boolean;
}

export const ADMIN_STATUS_QUERY_KEY = ["admin-status"] as const;

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

export function useAdminStatus() {
  const isRestoring = useIsRestoring();
  const { data, isPending, isFetching, error, isFetched } = useQuery({
    queryKey: ADMIN_STATUS_QUERY_KEY,
    queryFn: fetchAdminStatus,
    // Uses global defaults: staleTime (30min), gcTime (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  // Only show loading when actually fetching initial data, not when cache is being restored
  const isInitialLoading = isPending && isFetching && !isRestoring;

  return {
    isAdmin: data?.isAdmin ?? false,
    isOrgAdmin: data?.isOrgAdmin ?? false,
    isLoading: isInitialLoading,
    isFetched,
    error: error as Error | null,
    // Combined check for showing any admin menu
    hasAdminAccess: (data?.isAdmin || data?.isOrgAdmin) ?? false,
  };
}
