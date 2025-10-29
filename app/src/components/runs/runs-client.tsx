"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createColumns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { TestRun } from "./schema";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Row } from "@tanstack/react-table";

export function RunsClient() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tableKey, setTableKey] = useState(0); // For forcing re-render
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetRuns = useCallback((runs: TestRun[] | ((prev: TestRun[]) => TestRun[])) => {
    if (mounted) {
      setRuns(runs);
    }
  }, [mounted]);

  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (mounted) {
      setIsLoading(loading);
    }
  }, [mounted]);

  const safeSetTableKey = useCallback((key: number | ((prev: number) => number)) => {
    if (mounted) {
      setTableKey(key);
    }
  }, [mounted]);

  // Created a reusable fetchRuns function with useCallback
  const fetchRuns = useCallback(async () => {
    safeSetIsLoading(true);
    try {
      const response = await fetch('/api/runs?limit=100');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch runs');
      }

      // Handle new paginated response format
      const fetchedRuns = result.data || result;

      // Cast status and map nulls to undefined
      const typedRuns = fetchedRuns.map((run: { 
        status?: string; 
        jobName?: string; 
        duration?: number; 
        startedAt?: string; 
        completedAt?: string; 
        reportUrl?: string; 
        logs?: string; 
        errorDetails?: string; 
        trigger?: string;
        [key: string]: unknown;
      }) => ({
        ...run,
        status: run.status as TestRun['status'],
        jobName: run.jobName ?? undefined,
        duration: run.duration ?? undefined,
        startedAt: run.startedAt ?? undefined,
        completedAt: run.completedAt ?? undefined,
        reportUrl: run.reportUrl ?? undefined,
        logs: run.logs ?? undefined,
        errorDetails: run.errorDetails ?? undefined,
        trigger: run.trigger ?? undefined,
      }));
      safeSetRuns(typedRuns);
    } catch (error) {
      console.error("Error fetching runs:", error);
      safeSetRuns([]);
      toast.error("Error fetching runs", {
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      });
    } finally {
      safeSetIsLoading(false);
    }
  }, [safeSetRuns, safeSetIsLoading]);

  useEffect(() => {
    // Initial fetch
    fetchRuns();
  }, [fetchRuns]);

  const handleRowClick = (row: Row<TestRun>) => {
    const runId = row.original.id;
    router.push(`/runs/${runId}`);
  };

  // Handler for when a run is deleted - refresh data without page reload
  const handleDeleteRun = useCallback(() => {
    // Update the table key to force a remount
    safeSetTableKey((prev: number)  => prev + 1);
    // Fetch fresh data
    fetchRuns();
    // Revalidate the page as well
    router.refresh();
  }, [fetchRuns, router, safeSetTableKey]);

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="flex h-full flex-col p-2 mt-6">
        <DataTableSkeleton columns={6} rows={3} />
      </div>
    );
  }

  // Create columns with the delete handler
  const columns = createColumns(handleDeleteRun);

  return (
    <div className="flex h-full flex-col p-2 mt-6">
      <DataTable
        key={tableKey}
        columns={columns}
        data={runs}
        isLoading={isLoading}
        onRowClick={handleRowClick}
      />
    </div>
  );
} 