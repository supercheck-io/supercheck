/**
 * Requirements Stats Hook
 * 
 * React Query hook for fetching requirements coverage stats for dashboard.
 */

import { useQuery } from "@tanstack/react-query";
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
  return useQuery({
    queryKey: REQUIREMENTS_STATS_QUERY_KEY,
    queryFn: getRequirementsDashboardStats,
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });
}
