"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Crown, Shield, User, Building2 } from "lucide-react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UserActions } from "./user-actions";
import { UUIDField } from "@/components/ui/uuid-field";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface UserOrganization {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role?: string;
  banned?: boolean;
  banReason?: string;
  createdAt: string;
  organizations?: UserOrganization[];
}

// Role changes are handled at the organization level via org admin interface
// Super admin focuses on system-level actions: impersonation, user management, etc.

const getRoleIcon = (role: string) => {
  switch (role) {
    case "super_admin":
      return <Crown className="mr-1 h-3.5 w-3.5" />;
    case "org_owner":
    case "org_admin":
      return <Shield className="mr-1 h-3.5 w-3.5" />;
    case "project_editor":
    case "project_viewer":
    default:
      return <User className="mr-1 h-3.5 w-3.5" />;
  }
};

const getRoleTone = (role: string): TableBadgeTone => {
  switch (role) {
    case "super_admin":
      return "purple";
    case "org_owner":
      return "indigo";
    case "org_admin":
      return "info";
    case "project_editor":
      return "success";
    case "project_viewer":
    default:
      return "slate";
  }
};

export const createUserColumns = (
  onUserUpdate: () => void
): ColumnDef<AdminUser>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="pl-1" column={column} title="User ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="flex items-center h-10">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("User ID copied to clipboard")}
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
        {row.getValue("name")}
      </div>
    ),
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => (
      <div className="flex items-center h-10 text-sm text-muted-foreground">
        {row.getValue("email")}
      </div>
    ),
  },
  {
    accessorKey: "role",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Role" />
    ),
    cell: ({ row }) => {
      const rawRole = row.getValue("role") as string;
      const role = rawRole || "project_viewer"; // Align with RBAC default

      // Display role names - NEW RBAC ONLY
      const getDisplayRole = (role: string) => {
        switch (role) {
          case "super_admin":
            return "Super Admin";
          case "org_owner":
            return "Organization Owner";
          case "org_admin":
            return "Organization Admin";
          case "project_editor":
            return "Project Editor";
          case "project_viewer":
            return "Project Viewer";
          default:
            return role.charAt(0).toUpperCase() + role.slice(1);
        }
      };

      return (
        <div className="flex items-center h-10">
          <TableBadge tone={getRoleTone(role)}>
            {getRoleIcon(role)}
            {getDisplayRole(role)}
          </TableBadge>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id) || "project_viewer");
    },
  },
  {
    id: "banned",
    accessorFn: (row) => {
      const banned = row.banned;
      return banned ? "banned" : "active";
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const banned = row.original.banned as boolean;
      return (
        <div className="flex items-center h-10">
          {banned ? (
            <TableBadge tone="danger">
              Banned
            </TableBadge>
          ) : (
            <TableBadge tone="success">
              Active
            </TableBadge>
          )}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const banned = row.original.banned as boolean;
      const status = banned ? "banned" : "active";
      return value.includes(status);
    },
  },
  {
    id: "organizations",
    accessorFn: (row) => row.organizations || [],
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Organizations" />
    ),
    cell: ({ row }) => {
      const organizations = row.original.organizations || [];

      if (organizations.length === 0) {
        return (
          <div className="flex items-center h-10 text-sm text-muted-foreground">
            <span className="italic">No organization</span>
          </div>
        );
      }

      // Show first organization with count if more
      const firstOrg = organizations[0];
      const remainingCount = organizations.length - 1;

      return (
        <div className="flex items-center h-10">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-default">
                  <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate max-w-[150px] text-sm">
                    {firstOrg.organizationName}
                  </span>
                  {remainingCount > 0 && (
                    <TableBadge compact tone="neutral">
                      +{remainingCount}
                    </TableBadge>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-medium text-xs">
                    Organizations ({organizations.length})
                  </p>
                  <div className="space-y-0.5">
                    {organizations.map((org) => (
                      <div
                        key={org.organizationId}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="truncate">{org.organizationName}</span>
                        <TableBadge compact tone="slate" className="text-[10px]">
                          {org.role.replace("_", " ")}
                        </TableBadge>
                      </div>
                    ))}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const organizations = row.original.organizations || [];
      // Filter by organization ID (value is an array of selected org IDs from faceted filter)
      if (Array.isArray(value)) {
        return organizations.some((org) => value.includes(org.organizationId));
      }
      // Fallback for string search
      return organizations.some((org) =>
        org.organizationName.toLowerCase().includes(String(value).toLowerCase())
      );
    },
    // enableSorting: false,
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
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const user = row.original;
      return (
        <div className="flex items-center h-10">
          <UserActions user={user} onUserUpdate={onUserUpdate} />
        </div>
      );
    },
  },
];
