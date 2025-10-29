"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Building, User } from "lucide-react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";

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
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <div className="py-2 font-medium flex items-center h-12">
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
        <div className="py-1 flex items-center h-12">
          {ownerEmail ? (
            <div className="flex items-center">
              <User className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{ownerEmail}</span>
            </div>
          ) : (
            <div className="flex items-center">
              <User className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground text-sm">No owner</span>
            </div>
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
        <div className="py-1 flex items-center h-12">
          {count !== undefined && count !== null ? (
            <Badge variant="outline" className="bg-blue-100 text-blue-700 text-xs px-3 py-1.5 font-medium">{count}</Badge>
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
        <div className="py-1 flex items-center h-12">
          {count !== undefined && count !== null ? (
            <Badge variant="outline" className="bg-green-100 text-green-700 text-xs px-3 py-1.5 font-medium">{count}</Badge>
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
        <div className="py-1 flex items-center text-sm">
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
        </div>
      );
    },
  },
];