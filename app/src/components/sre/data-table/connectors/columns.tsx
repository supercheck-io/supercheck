"use client";

import { ColumnDef } from "@tanstack/react-table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { type SreConnectorListItem } from "@/actions/sre-connectors";
import { getSreConnectorLabel } from "@/components/sre/connectors/connector-catalog";
import { isLiveSearchConnectorType } from "@/lib/sre/connectors/connector-capabilities";

type ConnectorTableMeta = {
  onSearch?: (connector: SreConnectorListItem) => void;
  onValidate?: (connector: SreConnectorListItem) => void;
  onViewJob?: (connector: SreConnectorListItem) => void;
  onRotate?: (connector: SreConnectorListItem) => void;
  onDisable?: (connector: SreConnectorListItem) => void;
  isValidating?: boolean;
  isLoadingJobResult?: boolean;
  isDisabling?: boolean;
};

const statusTones: Record<SreConnectorListItem["status"], TableBadgeTone> = {
  configured: "info",
  valid: "success",
  unreachable: "warning",
  missing_credentials: "warning",
  disabled: "slate",
};

const riskTones: Record<SreConnectorListItem["riskLevel"], TableBadgeTone> = {
  low: "slate",
  medium: "info",
  high: "warning",
  critical: "danger",
};

function supportsEvidenceSearch(connector: SreConnectorListItem) {
  return (
    connector.status !== "disabled" && isLiveSearchConnectorType(connector.type)
  );
}

function formatValidationTime(value: Date | string | null) {
  if (!value) return "Not validated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString();
}

function connectorCapabilityBadge(connectorType: SreConnectorListItem["type"]) {
  if (connectorType === "supercheck_native") {
    return {
      label: "Native",
      tone: "info" as const,
    };
  }

  if (isLiveSearchConnectorType(connectorType)) {
    return {
      label: "Live search",
      tone: "success" as const,
    };
  }

  return {
    label: "Setup only",
    tone: "warning" as const,
  };
}

export const columns: ColumnDef<SreConnectorListItem>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const connector = row.original;
      return <span className="font-medium">{connector.name}</span>;
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => {
      const connector = row.original;
      const capability = connectorCapabilityBadge(connector.type);
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <TableBadge compact>
            {getSreConnectorLabel(connector.type)}
          </TableBadge>
          <TableBadge tone={capability.tone} compact>
            {capability.label}
          </TableBadge>
        </div>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "executionMode",
    header: "Execution",
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <div className="min-w-0">
          <TableBadge
            tone={connector.executionMode === "direct" ? "info" : "purple"}
            compact
          >
            {connector.executionMode === "direct" ? "Direct" : "Private Agent"}
          </TableBadge>
          {connector.privateAgent && (
            <p
              className="mt-1 max-w-40 truncate text-xs text-muted-foreground"
              title={connector.privateAgent.name}
            >
              {connector.privateAgent.name}
            </p>
          )}
        </div>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "scope",
    header: "Service scope",
    accessorFn: (connector) => connector.scopedServiceIds.length,
    cell: ({ row }) => {
      const count = row.original.scopedServiceIds.length;
      return (
        <span className="text-sm text-muted-foreground">
          {count === 0
            ? "All services"
            : `${count} service${count === 1 ? "" : "s"}`}
        </span>
      );
    },
  },
  {
    accessorKey: "riskLevel",
    header: "Risk",
    cell: ({ row }) => (
      <TableBadge
        tone={riskTones[row.original.riskLevel]}
        compact
        className="capitalize"
      >
        {row.original.riskLevel}
      </TableBadge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <TableBadge
          tone={statusTones[connector.status]}
          compact
          className="capitalize"
        >
          {connector.status.replace(/_/g, " ")}
        </TableBadge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "lastValidatedAt",
    header: "Last validated",
    cell: ({ row }) => {
      const value = row.original.lastValidatedAt;
      return (
        <span
          className="whitespace-nowrap text-sm text-muted-foreground"
          title={formatValidationTime(value)}
        >
          {formatValidationTime(value)}
        </span>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const connector = row.original;
      const meta = table.options.meta as ConnectorTableMeta | undefined;
      const { onSearch, onValidate, onViewJob, onRotate, onDisable } =
        meta ?? {};

      return (
        <div className="flex items-center justify-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Open actions for ${connector.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onSearch?.(connector)}
                disabled={!supportsEvidenceSearch(connector)}
              >
                Search evidence
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onValidate?.(connector)}
                disabled={meta?.isValidating}
              >
                Validate connector
              </DropdownMenuItem>
              {connector.latestPrivateAgentJob && (
                <DropdownMenuItem
                  onClick={() => onViewJob?.(connector)}
                  disabled={meta?.isLoadingJobResult}
                >
                  View last job result
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onRotate?.(connector)}
                disabled={meta?.isDisabling || meta?.isValidating}
              >
                Rotate credential
              </DropdownMenuItem>
              {connector.status !== "disabled" && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDisable?.(connector)}
                >
                  Disable connector
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];
