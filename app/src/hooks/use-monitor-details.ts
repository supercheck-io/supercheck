import { useQuery, useQueryClient, useIsRestoring, keepPreviousData } from "@tanstack/react-query";
import type { MonitorResultItem } from "@/components/monitors/monitor-detail-client";
import { Role } from "@/lib/rbac/permissions-client";

export interface MonitorStats {
  period24h: {
    totalChecks: number;
    upChecks: number;
    uptimePercentage: number | null;
    avgResponseTimeMs: number | null;
    p95ResponseTimeMs: number | null;
  };
  period30d: {
    totalChecks: number;
    upChecks: number;
    uptimePercentage: number | null;
    avgResponseTimeMs: number | null;
    p95ResponseTimeMs: number | null;
  };
}

export interface MonitorResultsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface MonitorResultsResponse {
  data: MonitorResultItem[];
  pagination: MonitorResultsPagination;
}

export interface MonitorPermissions {
  userRole: Role;
  canEdit: boolean;
  canDelete: boolean;
  canToggle: boolean;
}

export const MONITOR_STATS_KEY = ["monitor-stats"] as const;
export const MONITOR_RESULTS_KEY = ["monitor-results"] as const;
export const MONITOR_PERMISSIONS_KEY = ["monitor-permissions"] as const;

async function fetchMonitorStats(
  monitorId: string,
  location?: string
): Promise<MonitorStats> {
  const params = new URLSearchParams();
  if (location && location !== "all") {
    params.append("location", location);
  }
  const url = `/api/monitors/${monitorId}/stats${params.toString() ? `?${params}` : ""}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch monitor stats: ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

async function fetchMonitorResults(
  monitorId: string,
  options: {
    page: number;
    limit: number;
    date?: string;
    location?: string;
  }
): Promise<MonitorResultsResponse> {
  const params = new URLSearchParams({
    page: options.page.toString(),
    limit: options.limit.toString(),
  });

  if (options.date) {
    params.append("date", options.date);
  }
  if (options.location && options.location !== "all") {
    params.append("location", options.location);
  }

  const response = await fetch(`/api/monitors/${monitorId}/results?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch monitor results: ${response.status}`);
  }

  return response.json();
}

async function fetchMonitorPermissions(
  monitorId: string
): Promise<MonitorPermissions> {
  const response = await fetch(`/api/monitors/${monitorId}/permissions`);
  if (!response.ok) {
    // Return restrictive defaults on error
    return {
      userRole: Role.PROJECT_VIEWER,
      canEdit: false,
      canDelete: false,
      canToggle: false,
    };
  }

  const result = await response.json();
  // Map the string role to the Role enum
  const roleValue = result.data?.userRole || "project_viewer";
  return {
    userRole: roleValue as Role,
    canEdit: result.data?.canEdit ?? false,
    canDelete: result.data?.canDelete ?? false,
    canToggle: result.data?.canToggle ?? false,
  };
}

export function useMonitorStats(monitorId: string, location: string = "all") {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  const query = useQuery({
    queryKey: [...MONITOR_STATS_KEY, monitorId, location],
    queryFn: () => fetchMonitorStats(monitorId, location),
    enabled: !!monitorId,
    staleTime: 30 * 1000,  // Monitor stats update frequently (30s)
    // gcTime uses global default (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',  // Always refetch on mount - monitor data must be fresh
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: [...MONITOR_STATS_KEY, monitorId],
      refetchType: 'all',
    });

  const isActuallyLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    stats: query.data,
    isLoading: isActuallyLoading,
    isRestoring,  // Expose for component-level hydration safety
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

export function useMonitorResults(
  monitorId: string,
  options: {
    page: number;
    limit: number;
    date?: Date;
    location?: string;
  }
) {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const dateString = options.date?.toISOString().split("T")[0];

  const query = useQuery({
    queryKey: [
      ...MONITOR_RESULTS_KEY,
      monitorId,
      options.page,
      options.limit,
      dateString,
      options.location,
    ],
    queryFn: () =>
      fetchMonitorResults(monitorId, {
        page: options.page,
        limit: options.limit,
        date: dateString,
        location: options.location,
      }),
    enabled: !!monitorId,
    staleTime: 30 * 1000,  // Monitor results update frequently (30s)
    // gcTime uses global default (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',  // Always refetch on mount - monitor data must be fresh
    refetchOnReconnect: false,
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: [...MONITOR_RESULTS_KEY, monitorId],
      refetchType: 'all',
    });

  const isActuallyLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    results: query.data?.data ?? [],
    pagination: query.data?.pagination ?? null,
    isLoading: isActuallyLoading,
    isRestoring,  // Expose for component-level hydration safety
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
  };
}

export function useMonitorPermissions(monitorId: string) {
  const isRestoring = useIsRestoring();
  const query = useQuery({
    queryKey: [...MONITOR_PERMISSIONS_KEY, monitorId],
    queryFn: () => fetchMonitorPermissions(monitorId),
    enabled: !!monitorId,
    // Uses global defaults: staleTime (30min), gcTime (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    permissions: query.data,
    userRole: query.data?.userRole ?? Role.PROJECT_VIEWER,
    canEdit: query.data?.canEdit ?? false,
    canDelete: query.data?.canDelete ?? false,
    canToggle: query.data?.canToggle ?? false,
    isLoading: isActuallyLoading,
    error: query.error as Error | null,
  };
}
