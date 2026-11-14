"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { NotificationChannel } from "./notification-channels-schema";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { Edit, Trash2, MoreHorizontal, Send } from "lucide-react";
import { TableBadge } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNotificationProviderConfig, PAGING_SERVICE_NAMES } from "./data";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { DateCell } from "@/components/ui/table-cells";
import { createdByColumn } from "@/components/ui/created-by-column";

interface TableMeta {
  onEdit?: (channel: NotificationChannel) => void;
  onDelete?: (channel: NotificationChannel) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  onTest?: (channel: NotificationChannel) => void;
}

/** Badge for a channel whose newest delivery (last 7 days) failed; nothing while it is healthy or unused. */
export function ChannelHealthBadge({ health }: { health?: NotificationChannel["health"] }) {
  if (health?.state === "auth_failed") return <TableBadge tone="danger" compact data-testid="channel-health-badge">Check the integration key</TableBadge>;
  if (health?.state === "failing") return <TableBadge tone="warning" compact data-testid="channel-health-badge">Last delivery failed</TableBadge>;
  return null;
}

export const notificationChannelColumns: ColumnDef<NotificationChannel>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Channel ID"
      />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="w-[90px]">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("Channel ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Title" />
    ),
    cell: ({ row }) => {
      const name = row.getValue("name") as string;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <TruncatedTextWithTooltip text={name} className="font-medium" maxWidth="200px" maxLength={30} />
          <ChannelHealthBadge health={row.original.health} />
        </div>
      );
    },
  },
  {
    accessorKey: "type",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Provider" />
    ),
    cell: ({ row }) => {
      const type = row.getValue("type") as string;
      const config = getNotificationProviderConfig(type);
      const IconComponent = config.icon;
      const preset = type === "webhook" ? row.original.config?.preset : undefined;
      return (
        <div className="flex items-center space-x-2">
          <IconComponent className={`h-4 w-4 ${config.color}`} />
          <span>{(typeof preset === "string" && PAGING_SERVICE_NAMES[preset]) || config.label}</span>
        </div>
      );
    },
  },
  createdByColumn<NotificationChannel>(),
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => {
      return (
        <DateCell
          value={row.getValue("createdAt") as string}
          empty="Unknown"
        />
      );
    },
  },
  {
    accessorKey: "lastUsed",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last Used" />
    ),
    cell: ({ row }) => {
      return (
        <DateCell
          value={row.getValue("lastUsed") as string}
          empty="Never"
        />
      );
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row, table }) => {
      const channel = row.original;
      const meta = table.options.meta as TableMeta;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex h-8 w-8 p-0 data-[state=open]:bg-muted">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {meta?.canEdit && meta.onTest && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  meta.onTest?.(channel);
                }}
                data-testid="channel-send-test"
              >
                <Send className="mr-2 h-4 w-4" />
                {channel.type === "webhook" ? "Send test page" : "Send test message"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={
                meta?.canEdit
                  ? (e) => {
                      e.stopPropagation();
                      meta?.onEdit?.(channel);
                    }
                  : undefined
              }
              disabled={!meta?.canEdit}
              className={!meta?.canEdit ? "opacity-50 cursor-not-allowed" : ""}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={
                meta?.canDelete
                  ? (e) => {
                      e.stopPropagation();
                      meta?.onDelete?.(channel);
                    }
                  : undefined
              }
              disabled={!meta?.canDelete}
              className={`text-destructive ${!meta?.canDelete ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
