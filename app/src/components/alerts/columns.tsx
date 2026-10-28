"use client";

import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { DateTimeCell } from "@/components/ui/date-time-cell";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { AlertHistory } from "./schema";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { getAlertTypeLabel, getNotificationProviderConfig } from "./data";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

const statusTones: Record<string, TableBadgeTone> = {
  sent: "success",
  failed: "danger",
  pending: "warning",
};

const typeTones: Record<string, TableBadgeTone> = {
  job_failed: "danger",
  job_success: "success",
  job_timeout: "warning",
  monitor_failure: "danger",
  monitor_recovery: "success",
  ssl_expiring: "warning",
};

// Separate component for notification provider cell to fix React hooks issue
// Displays provider as plain text with icon (consistent with Notification Channels tab)
const NotificationProviderCell = ({
  provider,
}: {
  provider: string | object | null | undefined;
}) => {
  // Handle null/undefined provider
  if (!provider) {
    return <div className="text-muted-foreground text-sm">No provider</div>;
  }

  // Handle case where provider is an object or not a string
  let providerString: string;
  if (typeof provider === "string") {
    providerString = provider;
  } else if (typeof provider === "object" && provider !== null) {
    // If it's an object, try to extract a string representation
    providerString = JSON.stringify(provider);
  } else {
    providerString = String(provider);
  }

  // Get the first provider (alerts are sent to one provider at a time)
  const providerType = providerString.split(",")[0]?.trim();

  if (!providerType) {
    return <div className="text-muted-foreground text-sm">No provider</div>;
  }

  const config = getNotificationProviderConfig(providerType);
  const IconComponent = config.icon;

  return (
    <div className="flex items-center space-x-2">
      <IconComponent className={`h-4 w-4 ${config.color}`} />
      <span>{config.label}</span>
    </div>
  );
};

export const columns: ColumnDef<AlertHistory>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader
        className="ml-2"
        column={column}
        title="Alert ID"
      />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="w-[90px] ml-2">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("Alert ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "targetName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const targetName = row.getValue("targetName") as string;
      return (
        <TruncatedTextWithTooltip
          text={targetName}
          className="font-medium"
          maxWidth="200px"
          maxLength={30}
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
      const type = row.getValue("type") as string;
      return (
        <TableBadge tone={typeTones[type] ?? "neutral"} compact>
          {getAlertTypeLabel(type)}
        </TableBadge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
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
        <TableBadge tone={statusTones[status] ?? "neutral"} compact className="capitalize">
          {status}
        </TableBadge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    id: "incident",
    accessorFn: (row) => row.incident?.number ?? null,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Incident" />
    ),
    cell: ({ row }) => {
      const incident = row.original.incident;
      return incident ? (
        <Link href={`/incidents/${incident.id}`} className="text-sm underline-offset-4 hover:underline">
          #{incident.number}
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground">-</span>
      );
    },
  },
  {
    accessorKey: "notificationProvider",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Provider" />
    ),
    cell: ({ row }) => {
      const provider = row.getValue("notificationProvider") as string;
      return <NotificationProviderCell provider={provider} />;
    },
    filterFn: (row, id, value: string[]) => {
      const providerString = row.getValue(id) as string;
      if (!providerString || value.length === 0) return true;

      const providers = providerString
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      return value.some((filterProvider) =>
        providers.some(
          (provider) => provider.toLowerCase() === filterProvider.toLowerCase()
        )
      );
    },
  },
  {
    accessorKey: "timestamp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Sent At" />
    ),
    cell: ({ row }) => {
      return (
        <DateTimeCell
          value={row.getValue("timestamp") as string}
          emptyLabel="Never"
        />
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
];

export type { AlertHistory };
