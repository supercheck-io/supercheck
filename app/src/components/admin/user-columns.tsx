"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Crown, Shield, User } from "lucide-react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UserActions } from './user-actions';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role?: string;
  banned?: boolean;
  banReason?: string;
  createdAt: string;
}


// Role changes are handled at the organization level via org admin interface
// Super admin focuses on system-level actions: impersonation, user management, etc.

const getRoleIcon = (role: string) => {
  switch (role) {
    case 'super_admin':
      return <Crown className="mr-2 h-4 w-4" />;
    case 'org_owner':
    case 'org_admin':
      return <Shield className="mr-2 h-4 w-4" />;
    case 'project_editor':
    case 'project_viewer':
    default:
      return <User className="mr-2 h-4 w-4" />;
  }
};

const getRoleColor = (role: string) => {
  switch (role) {
    case 'super_admin':
      return 'bg-purple-100 text-purple-800';
    case 'org_owner':
      return 'bg-indigo-100 text-indigo-800';
    case 'org_admin':
      return 'bg-blue-100 text-blue-800';
    case 'project_editor':
      return 'bg-green-100 text-green-800';
    case 'project_viewer':
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

export const createUserColumns = (onUserUpdate: () => void): ColumnDef<AdminUser>[] => [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <div className="py-2 flex items-center font-medium h-12">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => (
      <div className="py-2 flex items-center text-sm h-12">{row.getValue("email")}</div>
    ),
  },
  {
    accessorKey: "role",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Role" />
    ),
    cell: ({ row }) => {
      const rawRole = row.getValue("role") as string;
      const role = rawRole || 'project_viewer'; // Align with RBAC default
      
      // Display role names - NEW RBAC ONLY
      const getDisplayRole = (role: string) => {
        switch (role) {
          case 'super_admin': return 'Super Admin';
          case 'org_owner': return 'Organization Owner';
          case 'org_admin': return 'Organization Admin';
          case 'project_editor': return 'Project Editor';
          case 'project_viewer': return 'Project Viewer';
          default: return role.charAt(0).toUpperCase() + role.slice(1);
        }
      };
      
      return (
        <div className="py-1 flex items-center h-12">
          <Badge variant="outline" className={`${getRoleColor(role)} text-xs px-3 py-1.5 font-medium`}>
            {getRoleIcon(role)}
            {getDisplayRole(role)}
          </Badge>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id) || 'project_viewer');
    },
  },
  {
    id: "banned",
    accessorFn: (row) => {
      const banned = row.banned;
      return banned ? 'banned' : 'active';
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const banned = row.original.banned as boolean;
      return (
        <div className="py-1 flex items-center h-12">
          {banned ? (
            <Badge variant="outline" className="bg-red-100 text-red-700 text-xs px-3 py-1.5 font-medium capitalize">Banned</Badge>
          ) : (
            <Badge variant="outline" className="bg-green-100 text-green-700 text-xs px-3 py-1.5 font-medium capitalize">Active</Badge>
          )}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const banned = row.original.banned as boolean;
      const status = banned ? 'banned' : 'active';
      return value.includes(status);
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
        <div className="py-1 flex items-center text-sm h-12">
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const user = row.original;
      return <UserActions user={user} onUserUpdate={onUserUpdate} />;
    },
  },
];