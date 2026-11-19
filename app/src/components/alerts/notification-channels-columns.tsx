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
import { ChannelTypeIcon } from "@/components/alerts/channel-icon";
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

/** Provider key for sorting and the Provider filter: the paging preset when there is one, else the channel type. */
export function channelProviderKey(channel: NotificationChannel): string {
  const preset = channel.type === "webhook" ? channel.config?.preset : undefined;
  return typeof preset === "string" && PAGING_SERVICE_NAMES[preset] ? preset : channel.type;
}

/** "2 monitors, 1 job, incident policy" (sentence case), or undefined when nothing sends to the channel. */
export function channelUsageText(usage: NotificationChannel["usage"]): string | undefined {
  if (!usage) return undefined;
  const parts = [
    usage.monitors ? `${usage.monitors} ${usage.monitors === 1 ? "monitor" : "monitors"}` : "",
    usage.jobs ? `${usage.jobs} ${usage.jobs === 1 ? "job" : "jobs"}` : "",
    usage.policy ? "incident policy" : "",
  ].filter(Boolean);
  const text = parts.join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : undefined;
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
          <TruncatedTextWithTooltip text={name} className="font-medium" maxWidth="240px" maxLength={40} />
          <ChannelHealthBadge health={row.original.health} />
        </div>
      );
    },
  },
  {
    id: "type",
    accessorFn: channelProviderKey,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Provider" />
    ),
    cell: ({ row }) => {
      const type = row.original.type;
      const config = getNotificationProviderConfig(type);
      const preset = type === "webhook" ? row.original.config?.preset : undefined;
      return (
        <div className="flex items-center space-x-2">
          <ChannelTypeIcon type={type} presetId={typeof preset === "string" ? preset : undefined} />
          <span>{(typeof preset === "string" && PAGING_SERVICE_NAMES[preset]) || config.label}</span>
        </div>
      );
    },
  },
  {
    id: "usage",
    accessorFn: (channel) => (channel.usage ? channel.usage.monitors + channel.usage.jobs + (channel.usage.policy ? 1 : 0) : 0),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Used by" />,
    cell: ({ row }) => {
      const text = channelUsageText(row.original.usage);
      return text ? <span className="text-sm">{text}</span> : <span className="text-sm text-muted-foreground">Not used</span>;
    },
  },
  {
    id: "lastTest",
    accessorFn: (channel) => channel.lastTest?.at ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last test" />,
    cell: ({ row }) => {
      const test = row.original.lastTest;
      if (!test?.at) return <span className="text-sm text-muted-foreground">Not tested</span>;
      return (
        <div className="flex items-center gap-2" data-testid="channel-last-test">
          <TableBadge tone={test.state === "ok" ? "success" : "danger"} compact>{test.state === "ok" ? "Passed" : "Failed"}</TableBadge>
          <DateCell value={test.at} showTime={false} />
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
      <DataTableColumnHeader column={column} title="Last used" />
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
