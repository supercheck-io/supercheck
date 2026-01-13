import { useQuery, useMutation, useQueryClient, UseQueryResult, useIsRestoring } from "@tanstack/react-query";
import { useProjectContext } from "./use-project-context";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt?: string;
  createdByUserId?: string;
}

export const TAGS_QUERY_KEY = ["tags"] as const;
export const TEST_TAGS_QUERY_KEY = ["test-tags"] as const;
export const REQUIREMENT_TAGS_QUERY_KEY = ["requirement-tags"] as const;

export function getTagsListQueryKey(projectId: string | null) {
  return [...TAGS_QUERY_KEY, projectId] as const;
}

const EMPTY_TAGS_ARRAY: Tag[] = [];

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

export function useTags() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;
  const isRestoring = useIsRestoring();

  const queryKey = [...TAGS_QUERY_KEY, projectId];

  const result = useQuery({
    queryKey,
    queryFn: fetchTags,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !!projectId,
  });

  const isInitialLoading = result.isPending && result.isFetching && !isRestoring;

  return {
    tags: result.data ?? EMPTY_TAGS_ARRAY,
    isLoading: isInitialLoading,
    error: result.error as Error | null,
    refetch: result.refetch,
  };
}

export function useTestTags(testId: string | null): UseQueryResult<Tag[], Error> & { testTags: Tag[] } {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const result = useQuery({
    queryKey: [...TEST_TAGS_QUERY_KEY, projectId, testId],
    queryFn: () => fetchTestTags(testId!),
    enabled: !!testId && !!projectId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...result,
    testTags: result.data ?? EMPTY_TAGS_ARRAY,
  };
}

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

export function useRequirementTags(requirementId: string | null): UseQueryResult<Tag[], Error> & { requirementTags: Tag[] } {
  const { currentProject } = useProjectContext();
  const projectId = currentProject?.id ?? null;

  const result = useQuery({
    queryKey: [...REQUIREMENT_TAGS_QUERY_KEY, projectId, requirementId],
    queryFn: () => fetchRequirementTags(requirementId!),
    enabled: !!requirementId && !!projectId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...result,
    requirementTags: result.data ?? EMPTY_TAGS_ARRAY,
  };
}

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
