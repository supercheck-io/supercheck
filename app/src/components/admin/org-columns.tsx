"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Building, User } from "lucide-react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UUIDField } from "@/components/ui/uuid-field";
import { TableBadge } from "@/components/ui/table-badge";

export interface AdminOrganization {
  id: string;
  name: string;
  slug?: string;
  ownerEmail?: string;
  memberCount?: number;
  projectCount?: number;
  createdAt: string;
}

export const createOrgColumns = (): ColumnDef<AdminOrganization>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="pl-1" column={column} title="Org ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="flex items-center h-10">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("Organization ID copied to clipboard")}
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
    cell: ({ row }) => (
      <div className="flex items-center h-10 font-medium">
        <Building className="mr-2 h-4 w-4 text-muted-foreground" />
        {row.getValue("name")}
      </div>
    ),
  },
  {
    accessorKey: "ownerEmail",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Owner" />
    ),
    cell: ({ row }) => {
      const ownerEmail = row.getValue("ownerEmail") as string;
      return (
        <div className="flex items-center h-10">
          <User className="mr-2 h-4 w-4 text-muted-foreground" />
          {ownerEmail ? (
            <span className="text-sm">{ownerEmail}</span>
          ) : (
            <span className="text-muted-foreground text-sm">No owner</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "memberCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Members" />
    ),
    cell: ({ row }) => {
      const count = row.getValue("memberCount") as number;
      return (
        <div className="flex items-center h-10">
          {count !== undefined && count !== null ? (
              <TableBadge tone="info">{count}</TableBadge>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "projectCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Projects" />
    ),
    cell: ({ row }) => {
      const count = row.getValue("projectCount") as number;
      return (
        <div className="flex items-center h-10">
          {count !== undefined && count !== null ? (
              <TableBadge tone="success">{count}</TableBadge>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
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
      if (!createdAt) return null;

      const date = new Date(createdAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      return (
        <div className="flex items-center h-10 text-sm">
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">
            {formattedTime}
          </span>
        </div>
      );
    },
  },
];
