"use client";

import { ConnectorTypeLabel } from "@/components/logo/connector-logos";
import { ColumnDef } from "@tanstack/react-table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { UUIDField } from "@/components/ui/uuid-field";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DateCell } from "@/components/ui/table-cells";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { type SreConnectorListItem } from "@/actions/sre-connectors";
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
    accessorKey: "id",
    header: () => <span className="ml-2">Connector ID</span>,
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
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <TruncatedTextWithTooltip
          text={connector.name}
          maxLength={26}
          maxWidth="200px"
          className="font-medium"
        />
      );
    },
  },
  {
    accessorKey: "type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => {
      const connector = row.original;
      const capability = connectorCapabilityBadge(connector.type);
      return (
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 whitespace-nowrap">
          <ConnectorTypeLabel type={connector.type} />
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Execution" />
    ),
    cell: ({ row }) => {
      const connector = row.original;
      return (
        <TableBadge
          tone={connector.executionMode === "direct" ? "info" : "purple"}
          compact
        >
          {connector.executionMode === "direct" ? "Direct" : "Private Agent"}
        </TableBadge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "privateAgent",
    accessorFn: (connector) => connector.privateAgent?.name ?? "",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Private Agent" />
    ),
    cell: ({ row }) =>
      row.original.privateAgent ? (
        <TruncatedTextWithTooltip
          text={row.original.privateAgent.name}
          maxLength={20}
          maxWidth="160px"
          className="text-sm"
        />
      ) : (
        <span className="text-sm text-muted-foreground">-</span>
      ),
  },
  {
    id: "scope",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Service scope" />
    ),
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Risk" />
    ),
    cell: ({ row }) => (
      <TableBadge
        tone={riskTones[row.original.riskLevel]}
        compact
        className="capitalize"
      >
        {row.original.riskLevel}
      </TableBadge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last validated" />
    ),
    cell: ({ row }) => (
      <DateCell value={row.original.lastValidatedAt} empty="Not validated" />
    ),
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
                className="h-8 w-8"
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
