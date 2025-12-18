/**
 * Runs Data Hook
 *
 * React Query hook for fetching runs list.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Data always refetches on page visit to ensure new runs appear immediately.
 */

import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

// ============================================================================
// TYPES
// ============================================================================

export interface Run {
  id: string;
  jobId: string;
  jobName?: string;
  jobType?: "playwright" | "k6";
  status: "pending" | "running" | "passed" | "failed" | "error" | "cancelled";
  trigger: "manual" | "schedule" | "remote";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  duration?: string | null;
  location?: string | null;
  reportUrl?: string | null;
  errorDetails?: string | null;
  createdAt?: string;
  job?: {
    id: string;
    name: string;
    testId: string;
    test?: {
      id: string;
      name: string;
      type: string;
    };
  };
  report?: {
    id: string;
    status: string;
    summary?: string;
  };
}

export interface RunsResponse extends PaginatedResponse<Run> {}

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const RUNS_QUERY_KEY = ["runs"] as const;
export const RUN_QUERY_KEY = ["run"] as const;

// ============================================================================
// HOOK FACTORY
// ============================================================================

const runsHook = createDataHook<Run>({
  queryKey: RUNS_QUERY_KEY,
  endpoint: "/api/runs",
  staleTime: 0, // Always refetch on mount - ensures new runs appear immediately after job trigger
  gcTime: 5 * 60 * 1000, // 5 minutes cache - keeps data for back navigation
  refetchOnWindowFocus: false,
  singleItemField: "run",
});

// ============================================================================
// HOOKS
// ============================================================================

export interface UseRunsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  jobId?: string;
  from?: string;
  to?: string;
  enabled?: boolean;
}

/**
 * Hook to fetch runs list with React Query.
 * Data always refetches on page mount to show new runs immediately.
 */
export function useRuns(options: UseRunsOptions = {}) {
  const result = runsHook.useList(options as UseRunsOptions & { [key: string]: unknown });

  // Maintain backward compatible return shape
  return {
    ...result,
    runs: result.items, // Alias for backward compatibility
  };
}

/**
 * Hook to fetch a single run by ID with React Query.
 * 
 * @param runId - The ID of the run to fetch. If `null`, the query will be disabled.
 * @param options - Additional query options.
 * @param options.enabled - Whether the query should be enabled. Defaults to `true`.
 */
export function useRun(runId: string | null, options: { enabled?: boolean } = {}) {
  return runsHook.useSingle(runId, options);
}
