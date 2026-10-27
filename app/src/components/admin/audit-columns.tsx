"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Activity, User } from "lucide-react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AuditDetailsDialog,
  formatDate,
  getActionBadgeTone,
} from "./audit-details-dialog";
import { formatAuditAction } from "./audit-action-labels";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";

export interface AuditUser {
  id: string | null;
  name: string | null;
  email: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: AuditUser;
}

export const auditLogColumns: ColumnDef<AuditLog>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Timestamp" />
    ),
    cell: ({ row }) => {
      const { formattedDate, formattedTime } = formatDate(
        row.getValue("createdAt")
      );
      const date = new Date(row.getValue("createdAt"));
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();

      let timeAgo = "";
      if (diffMs < 60000) {
        timeAgo = "just now";
      } else if (diffMs < 3600000) {
        const minutes = Math.floor(diffMs / 60000);
        timeAgo = `${minutes}m ago`;
      } else if (diffMs < 86400000) {
        const hours = Math.floor(diffMs / 3600000);
        timeAgo = `${hours}h ago`;
      } else {
        const days = Math.floor(diffMs / 86400000);
        timeAgo = `${days}d ago`;
      }

      return (
        <div className="flex items-center h-10 min-w-[140px]">
          <div>
            <div className="text-sm font-medium text-foreground">
              <span>{formattedDate}</span>
              <span className="text-muted-foreground ml-1 text-xs">
                {formattedTime}
              </span>
            </div>
            <div className="text-xs text-muted-foreground font-medium">
              {timeAgo}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Action" />
    ),
    cell: ({ row }) => {
      const action = row.getValue("action") as string;

      return (
        <div className="flex items-center h-10">
          <Tooltip>
            <TooltipTrigger asChild>
              <TableBadge tone={getActionBadgeTone(action)}>
                <Activity className="mr-1.5 h-3 w-3" />
                {formatAuditAction(action)}
              </TableBadge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span className="font-mono">{action}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    id: "user",
    accessorFn: (row) => {
      const user = row.user as AuditUser;
      return user.name || "System";
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="User" />
    ),
    cell: ({ row }) => {
      const user = row.original.user as AuditUser;

      return (
        <div className="flex items-center h-10 min-w-[160px]">
          <div className="flex items-center gap-2.5">
            <div className="flex-shrink-0">
              <div className="w-7 h-7 bg-muted rounded-full flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {user.name || "System"}
              </div>
              {user.email && (
                <div className="text-xs text-muted-foreground truncate">
                  {user.email}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      if (!value || value.length === 0) return true;
      const userName = row.getValue(id) as string;
      return value.includes(userName);
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <div className="flex items-center h-10">
        <AuditDetailsDialog log={row.original} />
      </div>
    ),
  },
];
