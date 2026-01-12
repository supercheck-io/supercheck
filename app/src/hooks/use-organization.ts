/**
 * Organization Data Hook
 * 
 * Provides React Query hooks for organization-related data:
 * - Organization stats (member count, project count, etc.)
 * - Organization details (name, logo, slug, etc.)
 * - Organization members and invitations
 * - Organization projects
 * 
 * PERFORMANCE OPTIMIZATION:
 * - All hooks use React Query for caching
 * - Data is prefetched by DataPrefetcher when available
 * - Eliminates duplicate fetches across components
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================================================
// TYPES
// ============================================================================

export interface OrgStats {
  memberCount: number;
  projectCount: number;
  pendingInvitations: number;
  testCount?: number;
  monitorCount?: number;
  jobCount?: number;
  runCount?: number;
}

export interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviterName: string;
  inviterEmail: string;
}

export interface OrgProject {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  isDefault: boolean;
  organizationId: string;
  createdAt: string;
  _count?: {
    tests: number;
    monitors: number;
    jobs: number;
  };
}

// ============================================================================
// QUERY KEYS (exported for cache invalidation)
// ============================================================================

export const ORG_STATS_QUERY_KEY = ["organization", "stats"] as const;
export const ORG_DETAILS_QUERY_KEY = ["organization", "details"] as const;
export const ORG_MEMBERS_QUERY_KEY = ["organization", "members"] as const;
export const ORG_INVITATIONS_QUERY_KEY = ["organization", "invitations"] as const;
export const ORG_PROJECTS_QUERY_KEY = ["organization", "projects"] as const;

// ============================================================================
// FETCH FUNCTIONS (exported for prefetching)
// ============================================================================

export async function fetchOrgStats(): Promise<OrgStats> {
  const response = await fetch("/api/organizations/stats");
  if (!response.ok) {
    throw new Error("Failed to fetch organization stats");
  }
  const data = await response.json();
  // API returns { success: true, data: { projects, jobs, tests, ... } }
  const stats = data.data || data.stats || data;
  return {
    memberCount: stats.members || 0,
    projectCount: stats.projects || 0,
    pendingInvitations: stats.pendingInvitations || 0,
    testCount: stats.tests || 0,
    monitorCount: stats.monitors || 0,
    jobCount: stats.jobs || 0,
    runCount: stats.runs || 0,
  };
}

export async function fetchOrgDetails(): Promise<OrgDetails> {
  const response = await fetch("/api/organizations/current");
  if (!response.ok) {
    throw new Error("Failed to fetch organization details");
  }
  const data = await response.json();
  // API returns { success: true, data: { id, name, slug, logo, createdAt } }
  const details = data.data || data.organization || data;
  return {
    id: details.id,
    name: details.name,
    slug: details.slug,
    logo: details.logo,
    createdAt: details.createdAt,
    metadata: details.metadata,
  };
}

export async function fetchOrgMembers(): Promise<{ members: OrgMember[]; invitations: PendingInvitation[]; currentUserRole: string }> {
  const response = await fetch("/api/organizations/members");
  if (!response.ok) {
    throw new Error("Failed to fetch organization members");
  }
  const data = await response.json();
  // API returns { success: true, data: { members, invitations, currentUserRole } }
  return {
    members: data.data?.members || data.members || [],
    invitations: data.data?.invitations || data.invitations || [],
    currentUserRole: data.data?.currentUserRole || data.currentUserRole || "project_viewer",
  };
}

// Note: fetchOrgInvitations removed - invitations are now included in fetchOrgMembers response

export async function fetchOrgProjects(): Promise<OrgProject[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error("Failed to fetch organization projects");
  }
  const data = await response.json();
  // API returns { success: true, data: [...] }
  return data.data || data || [];
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to get organization stats
 */
export function useOrgStats() {
  const query = useQuery({
    queryKey: ORG_STATS_QUERY_KEY,
    queryFn: fetchOrgStats,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 60 * 60 * 1000,   // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    stats: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Hook to get organization details
 */
export function useOrgDetails() {
  const query = useQuery({
    queryKey: ORG_DETAILS_QUERY_KEY,
    queryFn: fetchOrgDetails,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 60 * 60 * 1000,   // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    details: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * Hook to get organization members (includes invitations and current user role)
 */
export function useOrgMembers() {
  const query = useQuery({
    queryKey: ORG_MEMBERS_QUERY_KEY,
    queryFn: fetchOrgMembers,
    staleTime: 2 * 60 * 1000, // 2 minutes - members may change more frequently
    gcTime: 60 * 60 * 1000,   // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    members: query.data?.members ?? [],
    invitations: query.data?.invitations ?? [],
    currentUserRole: query.data?.currentUserRole ?? "project_viewer",
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

// Note: useOrgInvitations removed - invitations are now included in useOrgMembers

/**
 * Hook to get organization projects
 */
export function useOrgProjects() {
  const query = useQuery({
    queryKey: ORG_PROJECTS_QUERY_KEY,
    queryFn: fetchOrgProjects,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 60 * 60 * 1000,   // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    projects: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

// ============================================================================
// CACHE INVALIDATION UTILITIES
// ============================================================================

/**
 * Hook to get cache invalidation functions
 */
export function useOrgDataInvalidation() {
  const queryClient = useQueryClient();

  return {
    invalidateStats: () => queryClient.invalidateQueries({ queryKey: ORG_STATS_QUERY_KEY }),
    invalidateDetails: () => queryClient.invalidateQueries({ queryKey: ORG_DETAILS_QUERY_KEY }),
    invalidateMembers: () => queryClient.invalidateQueries({ queryKey: ORG_MEMBERS_QUERY_KEY }),
    invalidateProjects: () => queryClient.invalidateQueries({ queryKey: ORG_PROJECTS_QUERY_KEY }),
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  };
}

/**
 * Combined hook for org-admin page that needs all data
 * This fetches all org data in parallel when the page loads
 */
export function useOrgAdminData() {
  const stats = useOrgStats();
  const details = useOrgDetails();
  const membersData = useOrgMembers(); // Includes invitations and currentUserRole
  const projects = useOrgProjects();
  const invalidation = useOrgDataInvalidation();

  // Combined loading state - true only if ALL data is loading
  const isLoading = stats.isLoading || details.isLoading;
  
  // Any fetching happening
  const isFetching = stats.isFetching || details.isFetching || 
                      membersData.isFetching || projects.isFetching;

  // Combined error
  const error = stats.error || details.error || membersData.error || projects.error;

  return {
    stats: stats.stats,
    details: details.details,
    members: membersData.members,
    invitations: membersData.invitations,
    currentUserRole: membersData.currentUserRole,
    projects: projects.projects,
    isLoading,
    isFetching,
    error,
    refetch: {
      stats: stats.refetch,
      details: details.refetch,
      members: membersData.refetch,
      projects: projects.refetch,
    },
    ...invalidation,
  };
}
