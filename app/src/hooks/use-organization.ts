import { useQuery, useQueryClient, useIsRestoring } from "@tanstack/react-query";

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

export const ORG_STATS_QUERY_KEY = ["organization", "stats"] as const;
export const ORG_DETAILS_QUERY_KEY = ["organization", "details"] as const;
export const ORG_MEMBERS_QUERY_KEY = ["organization", "members"] as const;
export const ORG_INVITATIONS_QUERY_KEY = ["organization", "invitations"] as const;
export const ORG_PROJECTS_QUERY_KEY = ["organization", "projects"] as const;

export async function fetchOrgStats(): Promise<OrgStats> {
  const response = await fetch("/api/organizations/stats");
  if (!response.ok) {
    throw new Error("Failed to fetch organization stats");
  }
  const data = await response.json();
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
  return {
    members: data.data?.members || data.members || [],
    invitations: data.data?.invitations || data.invitations || [],
    currentUserRole: data.data?.currentUserRole || data.currentUserRole || "project_viewer",
  };
}

export async function fetchOrgProjects(): Promise<OrgProject[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) {
    throw new Error("Failed to fetch organization projects");
  }
  const data = await response.json();
  return data.data || data || [];
}

export function useOrgStats() {
  const isRestoring = useIsRestoring();
  
  const query = useQuery({
    queryKey: ORG_STATS_QUERY_KEY,
    queryFn: fetchOrgStats,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isLoading && !isRestoring;

  return {
    stats: query.data ?? null,
    isLoading: isActuallyLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useOrgDetails() {
  const isRestoring = useIsRestoring();
  
  const query = useQuery({
    queryKey: ORG_DETAILS_QUERY_KEY,
    queryFn: fetchOrgDetails,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isLoading && !isRestoring;

  return {
    details: query.data ?? null,
    isLoading: isActuallyLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useOrgMembers() {
  const isRestoring = useIsRestoring();
  
  const query = useQuery({
    queryKey: ORG_MEMBERS_QUERY_KEY,
    queryFn: fetchOrgMembers,
    staleTime: 2 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isLoading && !isRestoring;

  return {
    members: query.data?.members ?? [],
    invitations: query.data?.invitations ?? [],
    currentUserRole: query.data?.currentUserRole ?? "project_viewer",
    isLoading: isActuallyLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

export function useOrgProjects() {
  const isRestoring = useIsRestoring();
  
  const query = useQuery({
    queryKey: ORG_PROJECTS_QUERY_KEY,
    queryFn: fetchOrgProjects,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isActuallyLoading = query.isLoading && !isRestoring;

  return {
    projects: query.data ?? [],
    isLoading: isActuallyLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

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
