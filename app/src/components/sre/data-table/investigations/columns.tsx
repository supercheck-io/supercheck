"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Archive, Download, MessageSquareText, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { SreInvestigationHistoryItem } from "@/lib/sre/investigation-queries";

function formatCompletedAt(value: Date | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export const columns: ColumnDef<SreInvestigationHistoryItem>[] = [
  {
    accessorKey: "incidentNumber",
    header: ({ column }) => <DataTableColumnHeader column={column} title="No." />,
    cell: ({ row }) => (
      <Badge variant="secondary" className="whitespace-nowrap">
        {row.original.incidentNumber ? `#${row.original.incidentNumber}` : "-"}
      </Badge>
    ),
    size: 72,
  },
  {
    accessorKey: "incidentTitle",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Incident" />,
    cell: ({ row }) => {
      const item = row.original;
      const title = item.incidentTitle ?? "Untitled incident";
      return (
        <div className="max-w-[420px]">
          <span className="block truncate font-medium" title={item.incidentId ? title : "Unscoped investigation"}>
            {item.incidentId ? title : "Unscoped investigation"}
          </span>
        </div>
      );
    }
  },
  {
    accessorKey: "rootCauseHypothesis",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Root Cause" />,
    cell: ({ row }) => (
      <div className="max-w-[220px] truncate text-sm text-muted-foreground" title={row.original.rootCauseHypothesis || ""}>
        {row.original.rootCauseHypothesis ?? "No root-cause summary"}
      </div>
    )
  },
  {
    accessorKey: "agentType",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Agent" />,
    cell: ({ row }) => (
      <Badge variant="outline" className="whitespace-nowrap capitalize border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300">
        {row.getValue("agentType")}
      </Badge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <Badge
          variant="outline"
          className={
            status === "completed"
              ? "whitespace-nowrap capitalize border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "whitespace-nowrap capitalize"
          }
        >
          {status.replace(/_/g, " ")}
        </Badge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "serviceName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
    cell: ({ row }) => <span className="whitespace-nowrap">{row.getValue("serviceName") ?? "-"}</span>,
  },
  {
    accessorKey: "evidenceCount",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Evidence" />,
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.evidenceCount}</span>
  },
  {
    accessorKey: "completedAt",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Completed" />,
    cell: ({ row }) => <span suppressHydrationWarning className="whitespace-nowrap text-muted-foreground">{formatCompletedAt(row.original.completedAt)}</span>
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const item = row.original;
      const meta = table.options.meta as any;
      const hasSnapshot = !!(meta?.savedSnapshotIds || {})[item.id];

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open actions for investigation ${
                item.incidentNumber ? `#${item.incidentNumber}` : item.id
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => meta?.onSnapshot?.(item)} disabled={meta?.isSnapshotPending && meta?.pendingSnapshotRunId === item.id}>
              <Archive className="mr-2 h-4 w-4" /> Save snapshot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => meta?.onReview?.(item)} disabled={!hasSnapshot}>
              <MessageSquareText className="mr-2 h-4 w-4" /> Review
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => meta?.onExport?.(item)}>
              <Download className="mr-2 h-4 w-4" /> Export report
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
  }
];
