import { useQuery, useQueryClient, useIsRestoring } from "@tanstack/react-query";

export interface SystemStats {
  users: {
    totalUsers: number;
    newUsersThisMonth: number;
    activeUsers: number;
    bannedUsers: number;
  };
  organizations: {
    totalOrganizations: number;
    totalProjects: number;
    totalJobs: number;
    totalTests: number;
    totalMonitors: number;
    totalRuns: number;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  banned: boolean;
  banReason?: string;
  banExpires?: string;
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  _count?: {
    members: number;
    projects: number;
  };
}

export const SUPER_ADMIN_STATS_QUERY_KEY = ["super-admin", "stats"] as const;
export const SUPER_ADMIN_USERS_QUERY_KEY = ["super-admin", "users"] as const;
export const SUPER_ADMIN_ORGS_QUERY_KEY = ["super-admin", "organizations"] as const;

export async function fetchSuperAdminStats(): Promise<SystemStats> {
  const response = await fetch("/api/admin/stats");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch stats");
  return data.data;
}

export async function fetchSuperAdminUsers(): Promise<AdminUser[]> {
  const response = await fetch("/api/admin/users?limit=10000&offset=0");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch users");
  return data.data;
}

export async function fetchSuperAdminOrganizations(): Promise<AdminOrganization[]> {
  const response = await fetch("/api/admin/organizations?limit=10000&offset=0&stats=true");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch organizations");
  return data.data;
}

export function useSuperAdminStats() {
  const isRestoring = useIsRestoring();

  const query = useQuery({
    queryKey: SUPER_ADMIN_STATS_QUERY_KEY,
    queryFn: fetchSuperAdminStats,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    stats: query.data ?? null,
    isLoading: isInitialLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useSuperAdminUsers() {
  const isRestoring = useIsRestoring();

  const query = useQuery({
    queryKey: SUPER_ADMIN_USERS_QUERY_KEY,
    queryFn: fetchSuperAdminUsers,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    users: query.data ?? [],
    isLoading: isInitialLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useSuperAdminOrganizations() {
  const isRestoring = useIsRestoring();

  const query = useQuery({
    queryKey: SUPER_ADMIN_ORGS_QUERY_KEY,
    queryFn: fetchSuperAdminOrganizations,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    organizations: query.data ?? [],
    isLoading: isInitialLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useSuperAdminDataInvalidation() {
  const queryClient = useQueryClient();

  return {
    invalidateStats: () => queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_STATS_QUERY_KEY }),
    invalidateUsers: () => queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_USERS_QUERY_KEY }),
    invalidateOrganizations: () => queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_ORGS_QUERY_KEY }),
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_STATS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_USERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_ORGS_QUERY_KEY });
    },
  };
}
