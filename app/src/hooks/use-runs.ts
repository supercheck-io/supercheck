import { createDataHook, type PaginatedResponse } from "./lib/create-data-hook";

export interface Run {
  id: string;
  jobId: string;
  jobName?: string;
  jobType?: "playwright" | "k6";
  status: "pending" | "running" | "passed" | "failed" | "error";
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

export const RUNS_QUERY_KEY = ["runs"] as const;
export const RUN_QUERY_KEY = ["run"] as const;

export function getRunsListQueryKey(projectId: string | null) {
  return [...RUNS_QUERY_KEY, projectId, "{}"] as const;
}

const runsHook = createDataHook<Run>({
  queryKey: RUNS_QUERY_KEY,
  endpoint: "/api/runs",
  staleTime: 5 * 1000,
  refetchOnWindowFocus: false,
  refetchOnMount: 'always',  // Always refetch on page visit - run status changes during execution
  singleItemField: "run",
});

export interface UseRunsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  jobId?: string;
  from?: string;
  to?: string;
  enabled?: boolean;
}

export function useRuns(options: UseRunsOptions = {}) {
  const result = runsHook.useList(options as UseRunsOptions & { [key: string]: unknown });

  return {
    ...result,
    runs: result.items,
  };
}

export function useRun(runId: string | null, options: { enabled?: boolean } = {}) {
  return runsHook.useSingle(runId, options);
}
