/**
 * Tests Data Hook
 *
 * React Query hook for fetching tests list with efficient caching.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Caches data for 60 seconds.
 */

import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

// ============================================================================
// TYPES
// ============================================================================

export interface Test {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type: "playwright" | "k6" | "api" | "browser" | "database" | "custom" | "performance";
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

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const TESTS_QUERY_KEY = ["tests"] as const;
export const TEST_QUERY_KEY = ["test"] as const;

export function getTestsListQueryKey(projectId: string | null) {
  return [...TESTS_QUERY_KEY, projectId, {}] as const;
}

// ============================================================================
// HOOK FACTORY
// ============================================================================

const testsHook = createDataHook<Test, CreateTestData, UpdateTestData>({
  queryKey: TESTS_QUERY_KEY,
  endpoint: "/api/tests",
  // Inherits staleTime (5min) and gcTime (24h) from factory defaults
  refetchOnWindowFocus: false, // OPTIMIZED: Prevent aggressive re-fetching on tab switch
  singleItemField: "test",
});

// ============================================================================
// HOOKS
// ============================================================================

export interface UseTestsOptions {
  type?: string;
  search?: string;
  enabled?: boolean;
}

/**
 * Hook to fetch tests list with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 */
export function useTests(options: UseTestsOptions = {}) {
  const result = testsHook.useList(options as UseTestsOptions & { [key: string]: unknown });

  return {
    ...result,
    tests: result.items, // Alias for component usage
    loading: result.isLoading, // Alias for component usage
  };
}

/**
 * Hook to fetch a single test by ID with React Query caching.
 */
export function useTest(testId: string | null) {
  return testsHook.useSingle(testId);
}

/**
 * Hook for test mutations (create, update, delete) with optimistic updates.
 */
export function useTestMutations() {
  const baseMutations = testsHook.useMutations();

  return {
    createTest: baseMutations.create,
    updateTest: baseMutations.update,
    deleteTest: baseMutations.remove,
  };
}