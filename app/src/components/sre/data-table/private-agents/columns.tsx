"use client";

import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";

import type { PrivateAgentListItem } from "@/actions/private-agents";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { DateCell } from "@/components/ui/table-cells";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { UUIDField } from "@/components/ui/uuid-field";

export type PrivateAgentTableMeta = {
  onRotate?: (agent: PrivateAgentListItem) => void;
  onDisable?: (agent: PrivateAgentListItem) => void;
  isMutating?: boolean;
};

export const privateAgentStatusTones: Record<
  PrivateAgentListItem["status"],
  TableBadgeTone
> = {
  pending: "info",
  connected: "success",
  disconnected: "warning",
  unhealthy: "danger",
  disabled: "slate",
};

export const privateAgentScope = (agent: PrivateAgentListItem) =>
  agent.projectScoped ? "Project" : "Organization";

export const columns: ColumnDef<PrivateAgentListItem>[] = [
  {
    accessorKey: "id",
    header: () => <span className="ml-2">Agent ID</span>,
    cell: ({ row }) => (
      <div className="ml-2 w-[90px]">
        <UUIDField value={row.original.id} maxLength={8} />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={row.original.name}
        maxLength={28}
        maxWidth="220px"
        className="font-medium"
      />
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <TableBadge
        tone={privateAgentStatusTones[row.original.status]}
        compact
        className="capitalize"
        title={row.original.lastError ?? undefined}
      >
        {row.original.status}
      </TableBadge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "version",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Version" />
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {row.original.version ?? "Not reported"}
      </span>
    ),
  },
  {
    accessorKey: "region",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Region" />
    ),
    cell: ({ row }) => (
      <span className="text-sm">{row.original.region ?? "No region"}</span>
    ),
  },
  {
    accessorKey: "networkLabel",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Network" />
    ),
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.networkLabel ?? "No network label"}
      </span>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "lastHeartbeatAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last heartbeat" />
    ),
    cell: ({ row }) => <DateCell value={row.original.lastHeartbeatAt} />,
  },
  {
    id: "scope",
    accessorFn: privateAgentScope,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Scope" />
    ),
    cell: ({ row }) => (
      <TableBadge
        tone={row.original.projectScoped ? "info" : "indigo"}
        compact
      >
        {privateAgentScope(row.original)}
      </TableBadge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const agent = row.original;
      const meta = table.options.meta as PrivateAgentTableMeta | undefined;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Open actions for ${agent.name}`}
              disabled={meta?.isMutating}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {agent.status !== "disabled" ? (
              <>
                <DropdownMenuItem onClick={() => meta?.onRotate?.(agent)}>
                  Rotate token
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => meta?.onDisable?.(agent)}
                >
                  Disable agent
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled>No actions available</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
