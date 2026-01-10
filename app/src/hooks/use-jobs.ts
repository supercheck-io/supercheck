/**
 * Jobs Data Hook
 *
 * React Query hook for fetching jobs list with efficient caching.
 * Uses the generic data hook factory for DRY, consistent behavior.
 * Cache is invalidated after mutations to ensure fresh data.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";
import { RUNS_QUERY_KEY } from "./use-runs";

// ============================================================================
// TYPES
// ============================================================================

export interface JobTest {
  id: string;
  title?: string;
  name?: string;
  description?: string | null;
  type?: string;
  priority?: string;
  script?: string;
  tags?: Array<{ id: string; name: string; color: string | null }>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface JobLastRun {
  id: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  errorDetails?: string | null;
}

export interface JobAlertConfig {
  enabled: boolean;
  notificationProviders?: string[];
  alertOnFailure?: boolean;
  alertOnSuccess?: boolean;
  alertOnTimeout?: boolean;
  failureThreshold?: number;
  recoveryThreshold?: number;
  customMessage?: string;
}

export interface Job {
  id: string;
  name: string;
  description?: string | null;
  cronSchedule?: string | null;
  status: "pending" | "running" | "passed" | "failed" | "error";
  jobType?: "playwright" | "k6";
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  projectId?: string;
  organizationId?: string;
  createdByUserId?: string;
  tests?: JobTest[];
  alertConfig?: JobAlertConfig | null;
  lastRun?: JobLastRun | null;
  tags?: Array<{ id: string; name: string; color: string }>;
  _count?: {
    runs: number;
  };
}

export interface JobsResponse extends PaginatedResponse<Job> {}

interface CreateJobData {
  name: string;
  testId: string;
  schedule?: string;
  description?: string;
}

interface UpdateJobData {
  id: string;
  name?: string;
  schedule?: string;
  description?: string;
  status?: string;
}

// ============================================================================
// QUERY KEYS (exported for external cache invalidation)
// ============================================================================

export const JOBS_QUERY_KEY = ["jobs"] as const;
export const JOB_QUERY_KEY = ["job"] as const;

// ============================================================================
// HOOK FACTORY
// ============================================================================

const jobsHook = createDataHook<Job, CreateJobData, UpdateJobData>({
  queryKey: JOBS_QUERY_KEY,
  endpoint: "/api/jobs",
  // Inherits staleTime (5min) and gcTime (24h) from factory defaults
  refetchOnWindowFocus: false, // OPTIMIZED: Prevent aggressive re-fetching on tab switch
  singleItemField: "job",
});

// ============================================================================
// HOOKS
// ============================================================================

export interface UseJobsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  enabled?: boolean;
}

/**
 * Hook to fetch jobs list with React Query caching.
 * Data is cached for 60 seconds and shared across components.
 */
export function useJobs(options: UseJobsOptions = {}) {
  const result = jobsHook.useList(options as UseJobsOptions & { [key: string]: unknown });

  // Maintain backward compatible return shape
  return {
    ...result,
    jobs: result.items, // Alias for backward compatibility
  };
}

/**
 * Hook to fetch a single job by ID with React Query caching.
 */
export function useJob(jobId: string | null) {
  return jobsHook.useSingle(jobId);
}

/**
 * Hook for job mutations (create, update, delete, trigger) with optimistic updates.
 */
export function useJobMutations() {
  const queryClient = useQueryClient();
  const baseMutations = jobsHook.useMutations();

  // Custom trigger mutation (not in factory)
  const triggerJob = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/jobs/${jobId}/run`, {
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to trigger job");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOBS_QUERY_KEY, refetchType: 'all' });
      // Also invalidate runs cache so new run appears immediately
      queryClient.invalidateQueries({ queryKey: RUNS_QUERY_KEY, refetchType: 'all' });
    },
  });

  return {
    createJob: baseMutations.create,
    updateJob: baseMutations.update,
    deleteJob: baseMutations.remove,
    triggerJob,
  };
}
