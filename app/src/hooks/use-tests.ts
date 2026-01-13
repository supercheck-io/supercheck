import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

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
  const baseMutations = testsHook.useMutations();

  return {
    createTest: baseMutations.create,
    updateTest: baseMutations.update,
    deleteTest: baseMutations.remove,
  };
}
