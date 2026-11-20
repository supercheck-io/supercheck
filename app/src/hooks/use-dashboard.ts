import { useQuery, useQueryClient, useIsRestoring, keepPreviousData } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";

export type { DashboardData, DashboardSeed } from "@/lib/dashboard/dashboard-data";
export { parseSystemHealth, transformDashboardData } from "@/lib/dashboard/dashboard-data";
import { transformDashboardData, type DashboardData, type DashboardSeed } from "@/lib/dashboard/dashboard-data";

export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

// Bump the version suffix to abandon entries written under ["dashboard", projectId] by the
// old hover prefetch, which stored the raw /api/dashboard payload where the
// dashboard expects normalized DashboardData. Those entries are persisted to
// localStorage for 24h and crashed the page on every visit.
export const getDashboardQueryKey = (projectId: string | null) =>
  [...DASHBOARD_QUERY_KEY, projectId, "v3"] as const;

export async function fetchDashboard(projectId: string | null = null): Promise<DashboardData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('Dashboard request timeout'), 30000);

  try {
    // The server resolves the project from this header, so prefetch and the
    // dashboard hook must request the same project to share one cache entry.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (projectId) headers["x-project-id"] = projectId;
    const dashboardResponse = await fetch("/api/dashboard", {
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    if (!dashboardResponse.ok) {
      throw new Error(
        `Dashboard API error: ${dashboardResponse.status} ${dashboardResponse.statusText}`
      );
    }

    const data = await dashboardResponse.json();
    return transformDashboardData(data);
  } catch (error) {
    clearTimeout(timeoutId);
    // fetch rejects with the abort reason (a string here), not an AbortError, so check the signal.
    if (controller.signal.aborted) {
      throw new Error('Dashboard request timed out. Please try again.');
    }
    throw error;
  }
}

export function useDashboard(seed?: DashboardSeed | null) {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  const queryKey = getDashboardQueryKey(projectId);
  // Only a seed for the project being shown counts; after a project switch the hook fetches as before.
  const usableSeed = seed && seed.projectId === projectId ? seed : undefined;
  // initialData only fills an empty query. On a client navigation back to the dashboard the server has just
  // read newer data, so it replaces an older cached entry before the mount refetch is decided (the page is
  // this key's only observer, and it has not subscribed yet on its first render). Idempotent: once applied,
  // the cached entry is as new as the seed and nothing more happens.
  if (usableSeed) {
    const cachedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
    if (cachedAt > 0 && cachedAt < usableSeed.updatedAt) {
      queryClient.setQueryData(queryKey, usableSeed.data, { updatedAt: usableSeed.updatedAt });
    }
  }

  const query = useQuery({
    queryKey,
    queryFn: () => fetchDashboard(projectId),
    enabled: !!projectId,
    initialData: usableSeed?.data,
    initialDataUpdatedAt: usableSeed?.updatedAt,
    staleTime: 60 * 1000,  // Dashboard data refreshes more frequently (60s)
    // gcTime uses global default (24h)
    refetchOnWindowFocus: false,
    // Refetch on every visit unless the data is under a minute old (a server seed from this page load).
    refetchOnMount: true,
    // Never saved to localStorage: a full page load gets it from the server, and an older saved
    // entry restored after mount would replace that fresher value.
    meta: { persist: false },
    refetchOnReconnect: false,
    retry: 2,
    // Note: Removed placeholderData to ensure fresh data is shown immediately after fetch
  });

  const refetch = () => query.refetch();

  const invalidate = () => 
    queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    data: query.data,
    isLoading: isInitialLoading,
    isRestoring,
    isRefetching: query.isRefetching,
    error: query.error as Error | null,
    refetch,
    invalidate,
  };
}
