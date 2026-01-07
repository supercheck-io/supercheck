"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import { AlertHistory } from "./schema";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { getNotificationProviderConfig } from "./data";
import { Clock } from "lucide-react";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

const statusColors = {
  sent: "bg-green-100 text-green-800 hover:bg-green-200",
  failed: "bg-red-100 text-red-800 hover:bg-red-200",
  pending: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
} as const;

const typeColors = {
  job_failed: "bg-red-100 text-red-800 hover:bg-red-200",
  job_success: "bg-green-100 text-green-800 hover:bg-green-200",
  job_timeout: "bg-orange-100 text-orange-800 hover:bg-orange-200",
  monitor_failure: "bg-red-100 text-red-800 hover:bg-red-200",
  monitor_recovery: "bg-green-100 text-green-800 hover:bg-green-200",
  ssl_expiring: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
} as const;

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
      <span className="capitalize">{config.label}</span>
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
      <DataTableColumnHeader column={column} title="Monitor or Job Name" />
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
      const colorClass =
        typeColors[type as keyof typeof typeColors] ||
        "bg-gray-100 text-gray-800 hover:bg-gray-200";
      return (
        <Badge className={`capitalize ${colorClass}`}>
          {type.replace(/_/g, " ")}
        </Badge>
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
      const status = row.getValue("status") as keyof typeof statusColors;
      return (
        <Badge className={`capitalize ${statusColors[status]}`}>{status}</Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
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
      const timestamp = row.getValue("timestamp") as string;
      if (!timestamp) {
        return <div className="text-muted-foreground">Never</div>;
      }
      return (
        <div className="flex flex-col">
          <div className="flex items-center">
            <Clock className="mr-2 h-4 w-4 text-muted-foreground self-center" />
            <div className="flex items-center">
              <span>
                {new Date(timestamp).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <span className="text-muted-foreground ml-1 text-xs">
              {new Date(timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
];

export type { AlertHistory };
