"use client";

import { ConnectorTypeLabel } from "@/components/logo/connector-logos";
import { ColumnDef } from "@tanstack/react-table";
import { TableBadge } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { UUIDField } from "@/components/ui/uuid-field";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SreDiagnosticQueryListItem } from "@/actions/sre-diagnostic-queries";

type DiagnosticRecipeTableMeta = {
  onDelete?: (query: SreDiagnosticQueryListItem) => void;
  isDisabling?: boolean;
};

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${Math.round(value / 1024)} KiB`;
}

export const columns: ColumnDef<SreDiagnosticQueryListItem>[] = [
  {
    accessorKey: "id",
    header: () => <span className="ml-2">Query ID</span>,
    cell: ({ row }) => (
      <div className="ml-2 w-[90px]">
        <UUIDField value={row.original.id} maxLength={8} />
      </div>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={row.original.name}
        maxLength={26}
        maxWidth="200px"
        className="font-medium"
      />
    ),
  },
  {
    id: "template",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Template" />
    ),
    cell: ({ row }) => (
      <div
        className="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
        title={row.original.template}
      >
        {row.original.template}
      </div>
    ),
  },
  {
    accessorKey: "connectorName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Connector" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={row.original.connectorName}
        maxLength={22}
        maxWidth="170px"
        className="font-medium"
      />
    ),
  },
  {
    id: "connectorType",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Connector Type" />
    ),
    cell: ({ row }) => (
      <ConnectorTypeLabel type={row.original.connectorType} />
    ),
  },
  {
    accessorKey: "queryType",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => {
      const queryType = row.getValue("queryType") as string;
      return (
        <TableBadge tone="info" compact>
          {queryType}
        </TableBadge>
      );
    },
  },
  {
    id: "limits",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Limits" />
    ),
    cell: ({ row }) => {
      const query = row.original;
      return (
        <span className="text-sm">
          {query.maxRows} rows · {formatBytes(query.maxBytes)} ·{" "}
          {query.maxSeconds}s
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <TableBadge
          tone={status === "active" ? "success" : "slate"}
          compact
          className="capitalize"
        >
          {status}
        </TableBadge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const query = row.original;
      const meta = table.options.meta as DiagnosticRecipeTableMeta | undefined;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
                className="h-8 w-8"
              aria-label={`Open actions for ${query.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => meta?.onDelete?.(query)}
              disabled={meta?.isDisabling || query.status === "disabled"}
              className="text-destructive focus:text-destructive"
            >
              Disable
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
