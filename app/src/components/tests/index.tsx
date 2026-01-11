"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useState, useCallback, useMemo, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Test } from "./schema";
import { Row } from "@tanstack/react-table";
import { useTests } from "@/hooks/use-tests";

export default function Tests() {
  const [selectedTest] = useState<Test | null>(null);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const router = useRouter();

  // Use React Query hook for tests data (cached, handles loading/error)
  // PERFORMANCE: Scripts excluded by default (API default) - no need to pass includeScript: false
  // This ensures cache key matches DataPrefetcher for instant renders
  const {
    tests: rawTests,
    isLoading,
    invalidate,
  } = useTests();

  // Transform tests data with memoization to match local Test schema
  const tests = useMemo<Test[]>(() => {
    if (!rawTests || rawTests.length === 0) return [];

    return rawTests.map((test) => ({
      ...test,
      title: test.title || test.name,
      priority: (test as unknown as { priority?: string }).priority || "medium",
      description: test.description || null,
      createdAt: test.createdAt ?? undefined,
      updatedAt: test.updatedAt ?? undefined,
    })) as Test[];
  }, [rawTests]);

  const handleRowClick = useCallback(
    (row: Row<Test>) => {
      const test = row.original;
      router.push(`/playground/${test.id}`);
    },
    [router]
  );

  const onTestDeleted = useCallback(() => {
    // Invalidate React Query cache to refresh tests list after deletion
    invalidate();
  }, [invalidate]);

  // Don't render until component is mounted
  if (!isMounted) {
    return (
      <div className="flex h-full flex-col p-2 mt-6">
        <DataTableSkeleton columns={5} rows={3} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-2 mt-6">
      <DataTable
        columns={columns}
        data={tests}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{
          onDeleteTest: onTestDeleted,
        }}
      />

      {selectedTest && (
        <div className="space-y-2 py-2">
          <div>
            <h3 className="font-medium">Title</h3>
            <p>{selectedTest.title}</p>
          </div>
          <div>
            <h3 className="font-medium">Description</h3>
            <p>{selectedTest.description || "No description provided"}</p>
          </div>
          <div>
            <h3 className="font-medium">Priority</h3>
            <p className="capitalize">{selectedTest.priority}</p>
          </div>
          <div>
            <h3 className="font-medium">Type</h3>
            <p className="capitalize">{selectedTest.type}</p>
          </div>
          <div className="flex space-x-2 pt-4">
            <Button
              onClick={() => router.push(`/playground/${selectedTest.id}`)}
              className="flex-1"
            >
              Open in Playground
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
