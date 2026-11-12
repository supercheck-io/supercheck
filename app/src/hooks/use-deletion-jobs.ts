"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface DeletionJobRow {
  id: string;
  scope: string;
  targetId: string;
  organizationId: string | null;
  state: "queued" | "running" | "completed" | "failed";
  phase: string | null;
  cursor: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: string;
  heartbeatAt: string | null;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
}

export const ADMIN_DELETION_JOBS_QUERY_KEY = ["admin", "deletion-jobs"] as const;

export function useAdminDeletionJobs() {
  const query = useQuery({
    queryKey: ADMIN_DELETION_JOBS_QUERY_KEY,
    queryFn: async (): Promise<DeletionJobRow[]> => {
      const response = await fetch("/api/admin/deletion-jobs");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()).data;
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });
  return { jobs: query.data ?? [], isLoading: query.isPending && query.isFetching, refetch: query.refetch };
}

export function useRetryDeletionJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch("/api/admin/deletion-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_DELETION_JOBS_QUERY_KEY }),
  });
}
