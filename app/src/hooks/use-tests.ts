import { useQueryClient } from "@tanstack/react-query";
import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";
import { DASHBOARD_QUERY_KEY } from "./use-dashboard";

export interface Test {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type:
    | "playwright"
    | "k6"
    | "api"
    | "browser"
    | "database"
    | "custom"
    | "performance";
  priority?: "low" | "medium" | "high";
  script?: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  organizationId: string;
  tags?: Array<{ id: string; name: string; color: string | null }>;
}

export interface TestsResponse extends PaginatedResponse<Test> {}

interface CreateTestData {
  name: string;
  type: string;
  script?: string;
  description?: string;
}

interface UpdateTestData {
  id: string;
  name?: string;
  script?: string;
  description?: string;
}

export const TESTS_QUERY_KEY = ["tests"] as const;
export const TEST_QUERY_KEY = ["test"] as const;

export function getTestsListQueryKey(projectId: string | null) {
  return [...TESTS_QUERY_KEY, projectId, "{}"] as const;
}

const testsHook = createDataHook<Test, CreateTestData, UpdateTestData>({
  queryKey: TESTS_QUERY_KEY,
  endpoint: "/api/tests",
  refetchOnWindowFocus: false,
  refetchOnMount: 'always',  // Always refetch on page visit for fresh data
  singleItemField: "test",
});

export interface UseTestsOptions {
  type?: string;
  search?: string;
  enabled?: boolean;
  includeScript?: boolean;
  limit?: number;
  page?: number;
}

export function useTests(options: UseTestsOptions = {}) {
  const result = testsHook.useList(
    options as UseTestsOptions & { [key: string]: unknown }
  );

  return {
    ...result,
    tests: result.items,
    loading: result.isLoading,
  };
}

export function useTest(testId: string | null) {
  return testsHook.useSingle(testId);
}

export function useTestMutations() {
  const queryClient = useQueryClient();
  const baseMutations = testsHook.useMutations();

  // Wrap base mutations to also invalidate dashboard (cross-entity invalidation)
  const createTest = {
    ...baseMutations.create,
    mutateAsync: async (...args: Parameters<typeof baseMutations.create.mutateAsync>) => {
      const result = await baseMutations.create.mutateAsync(...args);
      // Cross-entity: Dashboard shows Total Tests count
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
      return result;
    },
  };

  const deleteTest = {
    ...baseMutations.remove,
    mutateAsync: async (...args: Parameters<typeof baseMutations.remove.mutateAsync>) => {
      const result = await baseMutations.remove.mutateAsync(...args);
      // Cross-entity: Dashboard shows Total Tests count
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
      return result;
    },
  };

  return {
    createTest,
    updateTest: baseMutations.update,
    deleteTest,
  };
}

