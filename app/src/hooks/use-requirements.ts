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
  requirements?: Requirement[];
}

export const REQUIREMENTS_QUERY_KEY = ["requirements"] as const;
export const REQUIREMENT_QUERY_KEY = ["requirement"] as const;

export function getRequirementsListQueryKey(projectId: string | null) {
  return [...REQUIREMENTS_QUERY_KEY, projectId, "{}"] as const;
}

const requirementsHook = createDataHook<Requirement>({
  queryKey: REQUIREMENTS_QUERY_KEY,
  endpoint: "/api/requirements",
  // Inherits staleTime (5min) and gcTime (24h) from factory defaults
  refetchOnWindowFocus: false,
  refetchOnMount: 'always',  // Always refetch on page visit for fresh data
  singleItemField: "requirement",
});

export interface UseRequirementsOptions {
  page?: number;
  pageSize?: number;
  priority?: RequirementPriority;
  status?: RequirementCoverageStatus;
  search?: string;
  enabled?: boolean;
}

export function useRequirements(options: UseRequirementsOptions = {}) {
  const result = requirementsHook.useList(options as UseRequirementsOptions & { [key: string]: unknown });

  return {
    ...result,
    requirements: result.items,
    total: result.pagination?.total ?? 0,
    page: result.pagination?.page ?? 1,
    pageSize: result.pagination?.limit ?? 20,
  };
}

export function useRequirement(requirementId: string | null, options: { enabled?: boolean } = {}) {
  return requirementsHook.useSingle(requirementId, options);
}

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
