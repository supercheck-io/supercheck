/**
 * Runs Data Hook
 *
 * React Query hook for fetching runs list with efficient caching.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Caches data for 30 seconds (runs change frequently during execution).
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
  staleTime: 0, // 0 seconds - always fetch fresh data for runs to ensure status is up to date
  gcTime: 5 * 60 * 1000, // 5 minutes cache
  refetchOnWindowFocus: true,
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
  /** Polling interval in ms for in-progress runs (0 to disable) */
  pollingInterval?: number;
}

/**
 * Hook to fetch runs list with React Query caching.
 * Data is cached for 30 seconds and supports polling for in-progress runs.
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
 * Hook to fetch a single run by ID with React Query caching.
 * Supports polling for runs that are still in progress.
 */
export function useRun(runId: string | null, options: { pollingInterval?: number } = {}) {
  return runsHook.useSingle(runId, options);
}
