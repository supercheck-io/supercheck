/**
 * Tags Data Hook
 *
 * React Query hook for fetching and managing tags with efficient caching.
 * Uses project-scoped query keys for proper cache isolation between projects.
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Project-scoped cache prevents cross-project tag leakage
 * - staleTime: 60 seconds
 * - refetchOnWindowFocus: false to prevent aggressive re-fetching
 */

import { useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";

// ============================================================================
// TYPES
// ============================================================================

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt?: string;
  createdByUserId?: string;
}

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const TAGS_QUERY_KEY = ["tags"] as const;
export const TEST_TAGS_QUERY_KEY = ["test-tags"] as const;
export const REQUIREMENT_TAGS_QUERY_KEY = ["requirement-tags"] as const;

// Constant empty array to avoid creating new references on each render
const EMPTY_TAGS_ARRAY: Tag[] = [];

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function fetchTags(): Promise<Tag[]> {
  const response = await fetch("/api/tags");
  if (!response.ok) {
    throw new Error("Failed to fetch tags");
  }
  return response.json();
}

async function fetchTestTags(testId: string): Promise<Tag[]> {
  const response = await fetch(`/api/tests/${testId}/tags`);
  if (!response.ok) {
    throw new Error("Failed to fetch test tags");
  }
  return response.json();
}

async function createTagApi(data: { name: string; color?: string }): Promise<Tag> {
  const response = await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create tag");
  }
  return response.json();
}

async function deleteTagApi(tagId: string): Promise<{ deletedTag?: { name: string } }> {
  const response = await fetch(`/api/tags/${tagId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 409) {
      throw new Error(errorData.error || "Tag is currently in use and cannot be deleted");
    }
    throw new Error(errorData.error || "Failed to delete tag");
  }
  return response.json();
}

async function saveTestTagsApi(testId: string, tagIds: string[]): Promise<void> {
  const response = await fetch(`/api/tests/${testId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagIds }),
  });
  if (!response.ok) {
    throw new Error("Failed to save test tags");
  }
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to fetch all available tags with React Query caching.
 * Data is cached for 60 seconds and project-scoped.
 * 
 * CONSISTENCY: Uses project-scoped query key like other hooks.
 */
export function useTags(): UseQueryResult<Tag[], Error> & { tags: Tag[] } {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const result = useQuery({
    // CONSISTENCY: Project-scoped query key to prevent cross-project cache pollution
    queryKey: [...TAGS_QUERY_KEY, projectId],
    queryFn: fetchTags,
    staleTime: 60 * 1000, // 60 seconds - match other data hooks
    gcTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false, // OPTIMIZED: Prevent aggressive re-fetching
    enabled: !!projectId,
  });

  return {
    ...result,
    tags: result.data ?? EMPTY_TAGS_ARRAY,
  };
}

/**
 * Hook to fetch tags for a specific test with React Query caching.
 * Data is cached per test ID.
 */
export function useTestTags(testId: string | null): UseQueryResult<Tag[], Error> & { testTags: Tag[] } {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const result = useQuery({
    queryKey: [...TEST_TAGS_QUERY_KEY, projectId, testId],
    queryFn: () => fetchTestTags(testId!),
    enabled: !!testId && !!projectId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...result,
    testTags: result.data ?? EMPTY_TAGS_ARRAY,
  };
}

/**
 * Hook for tag mutations (create, delete) with automatic cache invalidation.
 */
export function useTagMutations() {
  const queryClient = useQueryClient();

  const createTag = useMutation({
    mutationFn: createTagApi,
    onSuccess: () => {
      // Invalidate all tags queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY, refetchType: 'all' });
    },
  });

  const deleteTag = useMutation({
    mutationFn: deleteTagApi,
    onSuccess: () => {
      // Invalidate all tags queries
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY, refetchType: 'all' });
    },
  });

  return {
    createTag,
    deleteTag,
  };
}

/**
 * Hook for saving test tags with automatic cache invalidation.
 *
 * Accepts testId as a mutation parameter to support both:
 * - Existing tests (testId available at mount)
 * - New tests (testId available only after creation)
 */
export function useSaveTestTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ testId, tagIds }: { testId: string; tagIds: string[] }) => {
      if (!testId) throw new Error("Test ID is required");
      return saveTestTagsApi(testId, tagIds);
    },
    onSuccess: () => {
      // Invalidate all test tags queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: TEST_TAGS_QUERY_KEY, refetchType: 'all' });
    },
  });
}

// ============================================================================
// REQUIREMENT TAG HOOKS
// ============================================================================

async function fetchRequirementTags(requirementId: string): Promise<Tag[]> {
  const response = await fetch(`/api/requirements/${requirementId}/tags`);
  if (!response.ok) {
    throw new Error("Failed to fetch requirement tags");
  }
  return response.json();
}

async function saveRequirementTagsApi(requirementId: string, tagIds: string[]): Promise<void> {
  const response = await fetch(`/api/requirements/${requirementId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagIds }),
  });
  if (!response.ok) {
    throw new Error("Failed to save requirement tags");
  }
}

/**
 * Hook to fetch tags for a specific requirement with React Query caching.
 * Mirrors useTestTags for consistency.
 */
export function useRequirementTags(requirementId: string | null): UseQueryResult<Tag[], Error> & { requirementTags: Tag[] } {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const result = useQuery({
    queryKey: [...REQUIREMENT_TAGS_QUERY_KEY, projectId, requirementId],
    queryFn: () => fetchRequirementTags(requirementId!),
    enabled: !!requirementId && !!projectId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...result,
    requirementTags: result.data ?? EMPTY_TAGS_ARRAY,
  };
}

/**
 * Hook for saving requirement tags with automatic cache invalidation.
 * Mirrors useSaveTestTags for consistency.
 */
export function useSaveRequirementTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requirementId, tagIds }: { requirementId: string; tagIds: string[] }) => {
      if (!requirementId) throw new Error("Requirement ID is required");
      return saveRequirementTagsApi(requirementId, tagIds);
    },
    onSuccess: () => {
      // Invalidate requirement tags queries and requirements list
      queryClient.invalidateQueries({ queryKey: REQUIREMENT_TAGS_QUERY_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ["requirements"], refetchType: 'all' });
    },
  });
}
