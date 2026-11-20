import { useQuery } from "@tanstack/react-query";
import { useShellBootstrap } from "@/components/shell-bootstrap";
import { seededQueryOptions } from "@/lib/query-seed";

interface AdminStatus {
  isAdmin: boolean;
  isOrgAdmin: boolean;
}

export const ADMIN_STATUS_QUERY_KEY = ["admin-status"] as const;

export async function fetchAdminStatus(): Promise<AdminStatus> {
  // One request answers both; /api/organizations/stats counted every org resource just to say 200 or 403.
  const response = await fetch("/api/admin/check");
  if (!response.ok) return { isAdmin: false, isOrgAdmin: false };
  try {
    const data = await response.json();
    // An older server during a rolling deploy omits isOrgAdmin: ask the org stats endpoint, as before.
    const isOrgAdmin =
      typeof data.isOrgAdmin === "boolean"
        ? data.isOrgAdmin
        : await fetch("/api/organizations/stats").then((r) => r.status === 200, () => false);
    return { isAdmin: data.isAdmin === true, isOrgAdmin };
  } catch {
    return { isAdmin: false, isOrgAdmin: false };
  }
}

export function useAdminStatus() {
  const bootstrap = useShellBootstrap();
  const { data, isPending, isFetching, error, isFetched } = useQuery({
    queryKey: ADMIN_STATUS_QUERY_KEY,
    queryFn: fetchAdminStatus,
    // Admin status needs fresh data on mount to ensure consistent sidebar visibility
    // refetchOnMount: "always" overrides the global refetchOnMount: false,
    // ensuring fresh data after impersonation or session changes
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    // Never saved to localStorage: each full page load gets it fresh from the server layout.
    meta: { persist: false },
    ...seededQueryOptions(bootstrap?.adminStatus, bootstrap?.readAt),
  });

  // Loading when pending and fetching (initial load)
  const isLoading = isPending && isFetching;

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
