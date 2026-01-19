import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";
import { RUNS_QUERY_KEY } from "./use-runs";
import { DASHBOARD_QUERY_KEY } from "./use-dashboard";

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

export const JOBS_QUERY_KEY = ["jobs"] as const;
export const JOB_QUERY_KEY = ["job"] as const;

export function getJobsListQueryKey(projectId: string | null) {
  return [...JOBS_QUERY_KEY, projectId, "{}"] as const;
}

const jobsHook = createDataHook<Job, CreateJobData, UpdateJobData>({
  queryKey: JOBS_QUERY_KEY,
  endpoint: "/api/jobs",
  staleTime: 30 * 1000,  // 30 seconds - job status changes frequently with runs
  refetchOnWindowFocus: false,
  singleItemField: "job",
});

export interface UseJobsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  enabled?: boolean;
}

export function useJobs(options: UseJobsOptions = {}) {
  const result = jobsHook.useList(options as UseJobsOptions & { [key: string]: unknown });

  return {
    ...result,
    jobs: result.items,
  };
}

export function useJob(jobId: string | null) {
  return jobsHook.useSingle(jobId);
}

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
      // Invalidate dashboard cache to update stats and recent runs
      queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, refetchType: 'all' });
    },
  });

  return {
    createJob: baseMutations.create,
    updateJob: baseMutations.update,
    deleteJob: baseMutations.remove,
    triggerJob,
  };
}
