"use client";

import { ColumnDef } from "@tanstack/react-table";
import { TableBadge } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SreDiagnosticQueryListItem } from "@/actions/sre-diagnostic-queries";
import { getSreConnectorLabel } from "@/components/sre/connectors/connector-catalog";

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
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap">{row.original.name}</span>
    ),
  },
  {
    id: "template",
    header: "Template",
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
    header: "Connector",
    cell: ({ row }) => (
      <span className="font-medium whitespace-nowrap">
        {row.original.connectorName}
      </span>
    ),
  },
  {
    id: "connectorType",
    header: "Connector Type",
    cell: ({ row }) => (
      <TableBadge compact>
        {getSreConnectorLabel(row.original.connectorType)}
      </TableBadge>
    ),
  },
  {
    accessorKey: "queryType",
    header: "Type",
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
    header: "Limits",
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
    header: "Status",
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
