/**
 * Requirements Stats Hook
 * 
 * React Query hook for fetching requirements coverage stats for dashboard.
 */

import { useQuery, useIsRestoring } from "@tanstack/react-query";
import { getRequirementsDashboardStats } from "@/actions/requirements";

export interface RequirementsStats {
  total: number;
  covered: number;
  failing: number;
  missing: number;
  coveragePercent: number;
  atRiskCount: number;
}

export const REQUIREMENTS_STATS_QUERY_KEY = ["requirements", "stats"] as const;

/**
 * Hook to fetch requirements stats for dashboard card.
 */
export function useRequirementsStats() {
  const isRestoring = useIsRestoring();

  const query = useQuery({
    queryKey: REQUIREMENTS_STATS_QUERY_KEY,
    queryFn: getRequirementsDashboardStats,
    // Uses global defaults: staleTime (30min), gcTime (24h)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const isInitialLoading = query.isPending && query.isFetching && !isRestoring;

  return {
    ...query,
    isLoading: isInitialLoading,
  };
}
