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
import { PageHeader } from "@/components/shared/page-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Button } from "@/components/ui/button";
import { useTestPermissions } from "@/hooks/use-rbac-permissions";
import { NAV } from "@/lib/nav-areas";
import { Plus } from "lucide-react";

// GET /api/tests returns at most this many rows and the list has no pagination.
const TESTS_LIST_CAP = 200;

export default function Tests() {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const router = useRouter();
  const { canCreateTest } = useTestPermissions();

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
      <div className="space-y-4">
        <DataTableSkeleton columns={5} rows={3} />
      </div>
    );
  }

  if (error && tests.length === 0) {
    return <ListErrorState title="Failed to fetch tests" error={error} onRetry={() => invalidate()} />;
  }

  const isEmpty = !isLoading && tests.length === 0;
  const createButton = (
    <Button
      disabled={!canCreateTest}
      data-testid="create-test-button"
      onClick={() => router.push("/tests/create")}
    >
      <Plus className="h-4 w-4 mr-2" />
      Create test
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tests"
        icon={NAV.tests.icon}
        tone={NAV.tests.tone}
        description="Manage tests and their configurations"
        actions={isEmpty ? undefined : createButton}
      />
      <ListCapNote count={tests.length} cap={TESTS_LIST_CAP} />
      {isEmpty ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No tests yet"
          description="Create a test to check your app in a real browser, an API or a performance run."
          icon={<NAV.tests.icon className="h-10 w-10" />}
          action={createButton}
        />
      ) : (
        <DataTable
          columns={columns}
          data={tests}
          isLoading={isLoading}
          onRowClick={handleRowClick}
          meta={{
            onDeleteTest: onTestDeleted,
          }}
        />
      )}
    </div>
  );
}
