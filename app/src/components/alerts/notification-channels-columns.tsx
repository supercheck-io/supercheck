"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import { NotificationChannel } from "./notification-channels-schema";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { Clock, Edit, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { getNotificationProviderConfig } from "./data";
import { formatDistance } from "date-fns";

interface TableMeta {
  onEdit?: (channel: NotificationChannel) => void;
  onDelete?: (channel: NotificationChannel) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export const notificationChannelColumns: ColumnDef<NotificationChannel>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="ml-2" column={column} title="Channel ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="w-[90px] ml-2">
          <UUIDField 
            value={id} 
            maxLength={24} 
            onCopy={() => toast.success("Channel ID copied to clipboard")}
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const name = row.getValue("name") as string;
      return (
        <div className="font-medium max-w-[200px] truncate">{name}</div>
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
      return (
        <div className="flex items-center space-x-2">
          <IconComponent className={`h-4 w-4 ${config.color}`} />
          <span className="capitalize">{type}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => {
      const createdAt = row.getValue("createdAt") as string;
      if (!createdAt) {
        return <div className="text-muted-foreground">Unknown</div>;
      }
      return (
        <div className="flex items-center">
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formatDistance(new Date(createdAt), new Date(), { addSuffix: true })}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "lastUsed",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last Used" />
    ),
    cell: ({ row }) => {
      const lastUsed = row.getValue("lastUsed") as string;
      if (!lastUsed) {
        return <span className="text-muted-foreground">Never</span>;
      }
      return (
        <div className="flex items-center">
          <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formatDistance(new Date(lastUsed), new Date(), { addSuffix: true })}</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row, table }) => {
      const channel = row.original;
      const meta = table.options.meta as TableMeta;
      
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={meta?.canEdit ? (e) => {
                e.stopPropagation();
                meta?.onEdit?.(channel);
              } : undefined}
              disabled={!meta?.canEdit}
              className={!meta?.canEdit ? "opacity-50 cursor-not-allowed" : ""}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={meta?.canDelete ? (e) => {
                e.stopPropagation();
                meta?.onDelete?.(channel);
              } : undefined}
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