import { useHydrated } from "@/hooks/use-hydrated";
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

export function formatLocalDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

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
    timezoneOffset?: number;
    timezoneOffsetEnd?: number;
    location?: string;
    failuresOnly?: boolean;
  }
): Promise<MonitorResultsResponse> {
  const params = new URLSearchParams({
    page: options.page.toString(),
    limit: options.limit.toString(),
  });

  if (options.date) {
    params.append("date", options.date);
    if (typeof options.timezoneOffset === "number") {
      params.append("timezoneOffset", options.timezoneOffset.toString());
    }
    if (typeof options.timezoneOffsetEnd === "number") {
      params.append("timezoneOffsetEnd", options.timezoneOffsetEnd.toString());
    }
  }
  if (options.location && options.location !== "all") {
    params.append("location", options.location);
  }
  if (options.failuresOnly) {
    params.append("status", "failed");
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
  // A failed request is not a denial: surface it as an error so callers do not treat it as "viewer".
  if (!response.ok) throw new Error("Failed to load monitor permissions");

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
  const hydrated = useHydrated();

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
    stats: hydrated ? query.data : undefined,
    isLoading: hydrated && isActuallyLoading,
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
    failuresOnly?: boolean;
  }
) {
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();
  const hydrated = useHydrated();
  const dateString = options.date ? formatLocalDateParam(options.date) : undefined;
  // The offset at each local midnight: a DST change day starts and ends on different offsets.
  const dayOffset = (days: number) =>
    options.date
      ? new Date(options.date.getFullYear(), options.date.getMonth(), options.date.getDate() + days).getTimezoneOffset()
      : undefined;
  const timezoneOffset = dayOffset(0);
  const timezoneOffsetEnd = dayOffset(1);

  const query = useQuery({
    queryKey: [
      ...MONITOR_RESULTS_KEY,
      monitorId,
      options.page,
      options.limit,
      dateString,
      options.location,
      options.failuresOnly ?? false,
    ],
    queryFn: () =>
      fetchMonitorResults(monitorId, {
        page: options.page,
        limit: options.limit,
        date: dateString,
        timezoneOffset,
        timezoneOffsetEnd,
        location: options.location,
        failuresOnly: options.failuresOnly,
      }),
    enabled: !!monitorId,
    // Always stale: the table refits its page size after mount, and that key change only refetches a stale entry
    // (refetchOnMount covers mounts, not key changes). A page cached seconds ago would hide new checks.
    staleTime: 0,
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
    results: (hydrated && query.data?.data) || [],
    pagination: (hydrated && query.data?.pagination) || null,
    isLoading: hydrated && isActuallyLoading,
    isRestoring,  // Expose for component-level hydration safety
    isFetching: hydrated && query.isFetching,
    // Rows of the previous page or page size, shown while the new one loads.
    isPlaceholderData: query.isPlaceholderData,
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
    // Role changes must show up on revisit, so do not trust the 24h persisted cache
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    permissions: query.data,
    userRole: query.data?.userRole ?? Role.PROJECT_VIEWER,
    canEdit: query.data?.canEdit ?? false,
    canDelete: query.data?.canDelete ?? false,
    canToggle: query.data?.canToggle ?? false,
    // True only once a request has succeeded since mount; cached or failed data is not a confirmed role.
    isConfirmed: query.isFetchedAfterMount && query.isSuccess,
    isLoading: isActuallyLoading,
    error: query.error as Error | null,
  };
}
