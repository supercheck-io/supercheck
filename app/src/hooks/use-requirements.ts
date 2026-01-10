/**
 * Requirements Data Hook
 *
 * React Query hook for fetching requirements list with efficient caching.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Cache is invalidated after mutations to ensure fresh data.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";
import { 
  createRequirement, 
  updateRequirement, 
  deleteRequirement,
  type CreateRequirementInput,
  type UpdateRequirementInput,
} from "@/actions/requirements";
import type { RequirementPriority, RequirementCoverageStatus, RequirementCreatedBy } from "@/db/schema/types";

// ============================================================================
// TYPES
// ============================================================================

export interface RequirementTag {
  id: string;
  name: string;
  color: string | null;
}

export interface Requirement {
  id: string;
  title: string;
  description: string | null;
  priority: RequirementPriority | null;
  tags: RequirementTag[];
  externalId: string | null;
  externalUrl: string | null;
  externalProvider: string | null;
  createdBy: RequirementCreatedBy;
  createdAt: string | null;
  updatedAt: string | null;
  sourceDocumentId: string | null;
  sourceDocumentName: string | null;
  sourceSection: string | null;
  coverageStatus: RequirementCoverageStatus;
  linkedTestCount: number;
  passedTestCount: number;
  failedTestCount: number;
}

export interface RequirementsResponse extends PaginatedResponse<Requirement> {
  requirements?: Requirement[]; // Alias for backward compatibility
}

// ============================================================================
// QUERY KEYS (exported for external cache invalidation and prefetching)
// ============================================================================

export const REQUIREMENTS_QUERY_KEY = ["requirements"] as const;
export const REQUIREMENT_QUERY_KEY = ["requirement"] as const;

export function getRequirementsListQueryKey(projectId: string | null) {
  return [...REQUIREMENTS_QUERY_KEY, projectId, {}] as const;
}

// ============================================================================
// HOOK FACTORY
// ============================================================================

const requirementsHook = createDataHook<Requirement>({
  queryKey: REQUIREMENTS_QUERY_KEY,
  endpoint: "/api/requirements",
  // Inherits staleTime (5min) and gcTime (24h) from factory defaults
  refetchOnWindowFocus: false,
  singleItemField: "requirement",
});

// ============================================================================
// HOOKS
// ============================================================================

export interface UseRequirementsOptions {
  page?: number;
  pageSize?: number;
  priority?: RequirementPriority;
  status?: RequirementCoverageStatus;
  search?: string;
  enabled?: boolean;
}

/**
 * Hook to fetch requirements list with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 * 
 * CONSISTENCY: Uses createDataHook factory like other hooks (runs, tests, jobs).
 */
export function useRequirements(options: UseRequirementsOptions = {}) {
  const result = requirementsHook.useList(options as UseRequirementsOptions & { [key: string]: unknown });

  // Maintain backward compatible return shape
  return {
    ...result,
    requirements: result.items, // Alias for backward compatibility
    total: result.pagination?.total ?? 0,
    page: result.pagination?.page ?? 1,
    pageSize: result.pagination?.limit ?? 20,
  };
}

/**
 * Hook to fetch a single requirement by ID with React Query caching.
 */
export function useRequirement(requirementId: string | null, options: { enabled?: boolean } = {}) {
  return requirementsHook.useSingle(requirementId, options);
}

/**
 * Hook for requirement mutations (create, update, delete) with cache invalidation.
 * 
 * NOTE: Mutations use server actions for form handling consistency and validation.
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
