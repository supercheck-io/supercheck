/**
 * Requirements Data Hook
 *
 * React Query hook for fetching requirements list with efficient caching.
 * Uses the same pattern as useJobs for consistency.
 * Cache is invalidated after mutations to ensure fresh data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getRequirements, 
  getRequirement,
  createRequirement, 
  updateRequirement, 
  deleteRequirement,
  type RequirementWithCoverage,
  type CreateRequirementInput,
  type UpdateRequirementInput,
} from "@/actions/requirements";
import type { RequirementPriority, RequirementCoverageStatus } from "@/db/schema/types";

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const REQUIREMENTS_QUERY_KEY = ["requirements"] as const;
export const REQUIREMENT_QUERY_KEY = ["requirement"] as const;

// ============================================================================
// TYPES
// ============================================================================

export interface UseRequirementsOptions {
  page?: number;
  pageSize?: number;
  priority?: RequirementPriority;
  status?: RequirementCoverageStatus;
  search?: string;
  enabled?: boolean;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to fetch requirements list with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 */
export function useRequirements(options: UseRequirementsOptions = {}) {
  const { enabled = true, ...queryOptions } = options;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...REQUIREMENTS_QUERY_KEY, queryOptions],
    queryFn: () => getRequirements(queryOptions),
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false,
    enabled,
  });

  return {
    ...query,
    requirements: query.data?.requirements ?? [],
    total: query.data?.total ?? 0,
    page: query.data?.page ?? 1,
    pageSize: query.data?.pageSize ?? 20,
    invalidate: () => queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' }),
  };
}

/**
 * Hook to fetch a single requirement by ID with React Query caching.
 */
export function useRequirement(requirementId: string | null) {
  return useQuery({
    queryKey: [...REQUIREMENT_QUERY_KEY, requirementId],
    queryFn: () => requirementId ? getRequirement(requirementId) : null,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!requirementId,
  });
}

/**
 * Hook for requirement mutations (create, update, delete) with cache invalidation.
 */
export function useRequirementMutations() {
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (data: CreateRequirementInput) => createRequirement(data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
      }
    },
  });

  const update = useMutation({
    mutationFn: (data: UpdateRequirementInput) => updateRequirement(data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
        queryClient.invalidateQueries({ queryKey: REQUIREMENT_QUERY_KEY, refetchType: 'all' });
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRequirement(id),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
      }
    },
  });

  return {
    createRequirement: create,
    updateRequirement: update,
    deleteRequirement: remove,
  };
}
