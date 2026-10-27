"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Activity, LogIn, Pencil, Plus, Trash2, User } from "lucide-react";
import { DateCell } from "@/components/ui/table-cells";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AuditDetailsDialog,
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

function ActionIcon({ action }: { action: string }) {
  const className = "mr-1.5 h-3 w-3";
  if (/delet|remov|revok/.test(action)) return <Trash2 className={className} />;
  if (/creat|add|invit/.test(action)) return <Plus className={className} />;
  if (/updat|chang|edit|rotat/.test(action)) return <Pencil className={className} />;
  if (/login|logout|sign/.test(action)) return <LogIn className={className} />;
  return <Activity className={className} />;
}

export const auditLogColumns: ColumnDef<AuditLog>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Timestamp" />
    ),
    cell: ({ row }) => (
      <DateCell value={row.getValue("createdAt") as string} />
    ),
  },
  {
    accessorKey: "action",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Action" />
    ),
    cell: ({ row }) => {
      const action = row.getValue("action") as string;

      return (
        <div className="flex items-center h-8">
          <Tooltip>
            <TooltipTrigger asChild>
              <TableBadge tone={getActionBadgeTone(action)}>
                <ActionIcon action={action} />
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
        <div className="flex h-8 min-w-[160px] items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <TruncatedTextWithTooltip
            text={user.email ? `${user.name || "System"} (${user.email})` : user.name || "System"}
            maxLength={26}
            maxWidth="220px"
            className="text-sm font-medium text-foreground"
          />
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
      <div className="flex items-center h-8">
        <AuditDetailsDialog log={row.original} />
      </div>
    ),
  },
];
