"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useRouter } from "next/navigation";
import { Test } from "./schema";
import { Row } from "@tanstack/react-table";
import { useTests } from "@/hooks/use-tests";
import { ListCapNote, ListErrorState } from "@/components/shared/list-states";

// GET /api/tests returns at most this many rows and the list has no pagination.
const TESTS_LIST_CAP = 200;

export default function Tests() {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const router = useRouter();

  // Use React Query hook for tests data (cached, handles loading/error)
  // This ensures cache key matches DataPrefetcher for instant renders
  const {
    tests: rawTests,
    isLoading,
    isRestoring,
    error,
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

  // Don't render until mounted and cache is restored
  if (!isMounted || isRestoring) {
    return (
      <div className="flex h-full flex-col p-2 mt-6">
        <DataTableSkeleton columns={5} rows={3} />
      </div>
    );
  }

  if (error && tests.length === 0) {
    return <ListErrorState title="Failed to fetch tests" error={error} onRetry={() => invalidate()} />;
  }

  return (
    <div className="flex h-full flex-col p-2 mt-6">
      <ListCapNote count={tests.length} cap={TESTS_LIST_CAP} />
      <DataTable
        columns={columns}
        data={tests}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{
          onDeleteTest: onTestDeleted,
        }}
      />

    </div>
  );
}
