import { useQuery } from "@tanstack/react-query";

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
  const { data, isLoading, error, isFetched } = useQuery({
    queryKey: ADMIN_STATUS_QUERY_KEY,
    queryFn: fetchAdminStatus,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return {
    isAdmin: data?.isAdmin ?? false,
    isOrgAdmin: data?.isOrgAdmin ?? false,
    isLoading,
    isFetched,
    error: error as Error | null,
    // Combined check for showing any admin menu
    hasAdminAccess: (data?.isAdmin || data?.isOrgAdmin) ?? false,
  };
}
