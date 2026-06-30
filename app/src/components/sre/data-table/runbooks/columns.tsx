"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SreDiagnosticQueryListItem } from "@/actions/sre-diagnostic-queries";

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
    cell: ({ row }) => <span className="font-medium whitespace-nowrap">{row.original.name}</span>,
  },
  {
    id: "template",
    header: "Template",
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate font-mono text-xs text-muted-foreground" title={row.original.template}>
        {row.original.template}
      </div>
    ),
  },
  {
    accessorKey: "connectorName",
    header: "Connector",
    cell: ({ row }) => <span className="font-medium whitespace-nowrap">{row.original.connectorName}</span>,
  },
  {
    id: "connectorType",
    header: "Connector Type",
    cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{row.original.connectorType}</span>,
  },
  {
    accessorKey: "queryType",
    header: "Type",
    cell: ({ row }) => {
      const queryType = row.getValue("queryType") as string;
      return <Badge variant="outline">{queryType}</Badge>;
    },
  },
  {
    id: "limits",
    header: "Limits",
    cell: ({ row }) => {
      const query = row.original;
      return (
        <span className="text-sm">
          {query.maxRows} rows · {formatBytes(query.maxBytes)} · {query.maxSeconds}s
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return <Badge variant={status === "active" ? "secondary" : "outline"}>{status}</Badge>;
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const query = row.original;
      const meta = table.options.meta as any;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => meta?.onEdit?.(query)}>
              Edit
            </DropdownMenuItem>
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
