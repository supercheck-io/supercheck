"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { Monitor } from "./schema";
import { Row } from "@tanstack/react-table";
import { useMonitors } from "@/hooks/use-monitors";
import { ListCapNote, ListErrorState } from "@/components/shared/list-states";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useProjectContext } from "@/hooks/use-project-context";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { canCreateMonitors } from "@/lib/rbac/client-permissions";
import { NAV } from "@/lib/nav-areas";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

// GET /api/monitors without params returns at most this many rows.
const MONITORS_LIST_CAP = 200;

/** `tabs` is the page's tab switcher, rendered in the header beside the create action. */
export default function MonitorsList({ tabs }: { tabs?: ReactNode } = {}) {
  const router = useRouter();
  const { currentProject } = useProjectContext();
  const canCreate = currentProject?.userRole ? canCreateMonitors(normalizeRole(currentProject.userRole)) : false;
  const [tableKey, setTableKey] = useState(0);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Use React Query hook for monitors data (cached, handles loading/error)
  // No pagination params = API returns all monitors for client-side filtering
  const { monitors, isLoading, isRestoring, error, refetch } = useMonitors();
  

  // Handle row click to navigate to monitor detail
  const handleRowClick = useCallback((row: Row<Monitor>) => {
    router.push(`/monitors/${row.original.id}`);
  }, [router]);
  
  // Handle delete callback
  const handleDeleteMonitor = useCallback(async () => {
    // Check if mounted before proceeding
    if (!isMounted) return;
    
    // The row action already invalidated the list; a second invalidate would restart the request.
    setTableKey(prev => prev + 1);
  }, [isMounted]);

  const loading = !isMounted || isRestoring;
  const isEmpty = !loading && !error && !isLoading && monitors.length === 0;
  const createButton = (
    <Button onClick={() => router.push("/monitors/create")} disabled={!canCreate} data-testid="create-monitor-button">
      <PlusIcon className="mr-2 h-4 w-4" />
      Create monitor
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Monitors"
        icon={NAV.monitors.icon}
        tone={NAV.monitors.tone}
        description="Manage uptime monitors and their configurations"
        actions={
          <>
            {tabs}
            {!isEmpty && !loading && !isLoading && (!error || monitors.length > 0) && createButton}
          </>
        }
      />
      {loading ? (
        <DataTableSkeleton columns={5} rows={3} />
      ) : error && monitors.length === 0 ? (
        <ListErrorState title="Failed to fetch monitors" error={error} onRetry={() => refetch()} />
      ) : isEmpty ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No monitors yet"
          description="Create a monitor to check an endpoint, host or scheduled job and get alerted when it fails."
          icon={<NAV.monitors.icon className="h-10 w-10" />}
          action={createButton}
        />
      ) : (
        <>
          {error && (
            <Alert variant="warning" data-testid="monitors-refresh-error">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                Could not refresh monitors. The list may be out of date.
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <ListCapNote count={monitors.length} cap={MONITORS_LIST_CAP} />
          <DataTable
            key={tableKey}
            columns={columns}
            data={monitors as unknown as Monitor[]}
            isLoading={isLoading}
            onRowClick={handleRowClick}
            meta={{
              onDeleteMonitor: handleDeleteMonitor,
            }}
          />
        </>
      )}
    </div>
  );
}
