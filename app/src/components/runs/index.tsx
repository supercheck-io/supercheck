"use client";

import React, { useState, useMemo, useCallback } from "react";
import { createColumns } from "./columns";
import { DataTable } from "./data-table";
import { TestRun } from "./schema";
import { useRouter } from "next/navigation";
import { Row } from "@tanstack/react-table";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteRuns } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { useRuns } from "@/hooks/use-runs";

/**
 * Format duration for display
 */
function formatDuration(
  rawDuration?: unknown,
  startedAt?: unknown,
  completedAt?: unknown
): string | null {
  if (typeof rawDuration === "string" && rawDuration.trim() !== "") {
    return rawDuration;
  }

  if (typeof startedAt === "string" && typeof completedAt === "string") {
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      const seconds = Math.round((end - start) / 1000);
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        return `${minutes}m${remainder ? ` ${remainder}s` : ""}`.trim();
      }
      if (seconds === 0) {
        return "<1s";
      }
      if (seconds > 0) {
        return `${seconds}s`;
      }
    }
  }

  return typeof rawDuration === "string" ? rawDuration : null;
}

export function Runs() {
  const router = useRouter();
  // Use lazy initialization to avoid impure function during render
  const [tableKey, setTableKey] = useState(() => Date.now());
  const { currentProject } = useProjectContext();

  // Check if user can delete runs
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canDelete = canDeleteRuns(normalizedRole);

  // Use React Query hook for runs data (cached, handles loading/error)
  // No pageSize specified = API returns all runs for client-side filtering
  const { runs: rawRuns, isLoading, invalidate } = useRuns();

  // Transform runs data with memoization
  const runs = useMemo<TestRun[]>(() => {
    if (!rawRuns || rawRuns.length === 0) return [];

    return rawRuns.map((run) => ({
      ...run,
      trigger: run.trigger ?? undefined,
      // Use jobType from API directly (not derived from nested job.test.type)
      jobType: (run.jobType as TestRun["jobType"]) ?? "playwright",
      location: run.location ?? null,
      duration: formatDuration(
        run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : null,
        run.startedAt,
        run.completedAt
      ),
    })) as TestRun[];
  }, [rawRuns]);

  const handleRowClick = useCallback((row: Row<TestRun>) => {
    const run = row.original;
    router.push(`/runs/${run.id}`);
  }, [router]);

  // Refresh data after deletion
  const handleDeleteRun = useCallback(() => {
    setTableKey(Date.now());
    invalidate();
  }, [invalidate]);

  // Create columns with the delete handler and permissions
  const columns = createColumns(handleDeleteRun, canDelete);

  return (
    <div className="flex h-full flex-col space-y-4 p-2 mt-6 w-full max-w-full overflow-x-hidden">
      <DataTable
        key={tableKey}
        columns={columns}
        data={runs}
        onRowClick={handleRowClick}
        isLoading={isLoading}
      />
    </div>
  );
}

