"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createColumns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { TestRun } from "./schema";
import { useRouter } from "next/navigation";
import { Row } from "@tanstack/react-table";
import { toast } from "sonner";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteRuns } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";

export function Runs() {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [tableKey, setTableKey] = useState(Date.now()); // Add key to force remounting
  const [mounted, setMounted] = useState(false);
  const { projectId, currentProject } = useProjectContext();
  
  // Check if user can delete runs
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canDelete = canDeleteRuns(normalizedRole);

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

  const safeSetTableKey = useCallback((key: number) => {
    if (mounted) {
      setTableKey(key);
    }
  }, [mounted]);

  const fetchRuns = useCallback(async () => {
    safeSetIsLoading(true);
    try {
      // Only fetch runs if we have a projectId and organizationId
      if (!projectId || !currentProject?.organizationId) {
        safeSetRuns([]);
        safeSetIsLoading(false);
        return;
      }

      const response = await fetch(`/api/runs?projectId=${projectId}&organizationId=${currentProject.organizationId}&limit=100`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch runs');
      }

      // Handle new paginated response format
      const runs = result.data || result;

      // Cast the data to TestRun[] to ensure type compatibility and handle trigger field
      const typedRuns = runs.map((run: { trigger?: string; [key: string]: unknown }) => ({
        ...run,
        trigger: run.trigger ?? undefined,
      }));
      safeSetRuns(typedRuns as TestRun[]);
    } catch (error) {
      console.error("Failed to fetch runs:", error);
      toast.error("Failed to fetch runs");
      safeSetRuns([]);
    } finally {
      safeSetIsLoading(false);
    }
  }, [safeSetRuns, safeSetIsLoading, projectId, currentProject?.organizationId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const handleRowClick = (row: Row<TestRun>) => {
    const run = row.original;
    router.push(`/runs/${run.id}`);
  };

  // Simple handler to refresh data after deletion
  const handleDeleteRun = () => {
    // Generate a new table key to force remounting
    safeSetTableKey(Date.now());
    // Refresh data after deletion
    fetchRuns();
  };

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="flex h-full flex-col space-y-4 p-2 mt-6 w-full max-w-full overflow-x-hidden">
        <DataTableSkeleton columns={6} rows={8} />
      </div>
    );
  }

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
