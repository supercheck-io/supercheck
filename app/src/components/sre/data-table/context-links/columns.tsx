"use client";

import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Unlink } from "lucide-react";

import type { SreIntegrationBindingListItem } from "@/actions/sre-integration-bindings";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableBadge } from "@/components/ui/table-badge";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

export type ContextLinkTableMeta = {
  onDisable?: (binding: SreIntegrationBindingListItem) => void;
};

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const scopeLabel = (binding: SreIntegrationBindingListItem) =>
  binding.services.length > 0
    ? binding.services.map((service) => service.name).join(", ")
    : "Project-wide";

export const columns: ColumnDef<SreIntegrationBindingListItem>[] = [
  {
    id: "integrationKey",
    accessorFn: (binding) => binding.integrationKey,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Integration" />
    ),
    cell: ({ row }) => (
      <TableBadge tone="info" compact>
        {titleCase(row.original.integrationKey)}
      </TableBadge>
    ),
  },
  {
    id: "provider",
    accessorFn: (binding) => binding.notificationProvider.name,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Alert provider" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={`${row.original.notificationProvider.name} (${row.original.notificationProvider.type})`}
        maxLength={28}
        maxWidth="220px"
        className="font-medium"
      />
    ),
  },
  {
    id: "connector",
    accessorFn: (binding) => binding.externalConnector.name,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Connector" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={`${row.original.externalConnector.name} (${titleCase(row.original.externalConnector.type)})`}
        maxLength={28}
        maxWidth="220px"
      />
    ),
  },
  {
    accessorKey: "correlationStrategy",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Correlation" />
    ),
    cell: ({ row }) => (
      <TableBadge compact className="capitalize">
        {row.original.correlationStrategy.replace(/_/g, " ")}
      </TableBadge>
    ),
  },
  {
    id: "scope",
    accessorFn: scopeLabel,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Scope" />
    ),
    cell: ({ row }) => (
      <TruncatedTextWithTooltip
        text={scopeLabel(row.original)}
        maxLength={24}
        maxWidth="180px"
        className="text-sm text-muted-foreground"
      />
    ),
  },
  {
    id: "status",
    accessorFn: (binding) => (binding.enabled ? "enabled" : "disabled"),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <TableBadge tone={row.original.enabled ? "success" : "slate"} compact>
        {row.original.enabled ? "Enabled" : "Disabled"}
      </TableBadge>
    ),
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const meta = table.options.meta as ContextLinkTableMeta | undefined;
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Open actions for ${row.original.notificationProvider.name} context link`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!row.original.enabled}
              onClick={() => meta?.onDisable?.(row.original)}
            >
              <Unlink className="mr-2 h-3.5 w-3.5" />
              Disable link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
