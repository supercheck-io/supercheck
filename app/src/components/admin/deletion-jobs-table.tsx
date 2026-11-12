"use client";

import * as React from "react";
import { RefreshCw, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import type { ColumnDef, Table as TableType } from "@tanstack/react-table";
import { useAdminDeletionJobs, useRetryDeletionJob, type DeletionJobRow } from "@/hooks/use-deletion-jobs";
import { Button } from "@/components/ui/button";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { AdminListToolbar } from "@/components/admin/admin-list-toolbar";

const STATE_TONE: Record<DeletionJobRow["state"], TableBadgeTone> = { queued: "neutral", running: "info", completed: "success", failed: "danger" };
const STATE_OPTIONS = ["queued", "running", "failed"].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

/** Super admin: unfinished background purges. A failed purge keeps its target hidden until someone retries it here. */
export function DeletionJobsTable() {
  const { jobs, isLoading, refetch } = useAdminDeletionJobs();
  const retry = useRetryDeletionJob();

  const columns = React.useMemo<ColumnDef<DeletionJobRow>[]>(() => [
    { accessorKey: "scope", header: ({ column }) => <DataTableColumnHeader column={column} title="Scope" />, cell: ({ row }) => <span className="capitalize">{row.original.scope}</span> },
    { accessorKey: "targetId", header: "Target", cell: ({ row }) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.original.targetId}</code> },
    {
      accessorKey: "state",
      header: ({ column }) => <DataTableColumnHeader column={column} title="State" />,
      cell: ({ row }) => <TableBadge tone={STATE_TONE[row.original.state]} compact>{row.original.state}</TableBadge>,
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    { accessorKey: "phase", header: "Phase", cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.phase ?? "-"}</span> },
    { accessorKey: "attempts", header: ({ column }) => <DataTableColumnHeader column={column} title="Attempts" /> },
    {
      accessorKey: "lastError",
      header: "Last error",
      cell: ({ row }) => <span className="block max-w-[320px] truncate text-xs text-muted-foreground" title={row.original.lastError ?? undefined}>{row.original.lastError ?? "-"}</span>,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Age" />,
      cell: ({ row }) => <span className="whitespace-nowrap text-sm">{formatDistanceToNowStrict(new Date(row.original.createdAt))}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => row.original.state !== "failed" ? null : (
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          aria-label={`Retry deletion ${row.original.targetId}`}
          onClick={() => retry.mutate(row.original.id, {
            onSuccess: () => toast.success("Deletion re-queued"),
            onError: (error) => toast.error(error.message),
          })}
        >
          <RotateCw className="mr-2 h-3.5 w-3.5" />
          Retry
        </Button>
      ),
    },
  ], [retry]);

  const Toolbar = React.useCallback(({ table }: { table: TableType<DeletionJobRow> }) => (
    <AdminListToolbar table={table} searchPlaceholder="Search deletions..." facets={[{ columnId: "state", title: "State", options: STATE_OPTIONS }]}>
      <Button variant="outline" onClick={() => refetch()}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </AdminListToolbar>
  ), [refetch]);

  if (isLoading && jobs.length === 0) return <TabLoadingSpinner message="Loading deletions..." />;

  return (
    <AdminDataTable
      columns={columns}
      data={jobs}
      toolbar={Toolbar}
      itemName="deletions"
      emptyTitle="No pending deletions"
      emptyDescription="Background purges of deleted jobs and monitors appear here until they finish."
      meta={{ globalFilterColumns: ["scope", "targetId", "phase", "lastError"] }}
    />
  );
}
