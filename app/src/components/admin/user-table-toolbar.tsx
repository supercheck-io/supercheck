import { useState } from "react";
import type { Table } from "@tanstack/react-table";
import {
  X,
  Search,
  Crown,
  User,
  UserCheck,
  UserX,
  UserPlus,
  Building2,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";

import { userRoles, userStatuses } from "./user-data";

interface Organization {
  id: string;
  name: string;
}

interface UserTableToolbarProps<TData> {
  table: Table<TData>;
  organizations?: Organization[];
  onCreateUser?: () => void;
}

export function UserTableToolbar<TData>({
  table,
  organizations = [],
  onCreateUser,
}: UserTableToolbarProps<TData>) {
  const [isExporting, setIsExporting] = useState(false);
  const isFiltered = table.getState().columnFilters.length > 0;

  // Handle CSV export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/admin/users/export");

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Get the blob from the response
      const blob = await response.blob();

      // Create download link and trigger download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      link.download = filenameMatch?.[1] || `users-export-${new Date().toISOString().split("T")[0]}.csv`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success("Users exported successfully");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export users");
    } finally {
      setIsExporting(false);
    }
  };

  // Get faceted unique values for roles from the table
  const roleColumn = table.getColumn("role");
  const roleFacets = roleColumn?.getFacetedUniqueValues();

  // Create role filter options from faceted values with proper icons
  const getRoleIcon = (role: string) => {
    if (!role || typeof role !== "string") return User;
    switch (role) {
      case "super_admin":
        return Crown;
      default:
        return User;
    }
  };

  const getRoleColor = (role: string) => {
    if (!role || typeof role !== "string") return "text-gray-600";
    switch (role) {
      case "super_admin":
        return "text-purple-600";
      default:
        return "text-gray-600";
    }
  };

  const availableRoles = roleFacets
    ? Array.from(roleFacets.keys())
      .filter((roleValue) => roleValue != null)
      .map((roleValue) => ({
        value: roleValue as string,
        label:
          roleValue === "super_admin"
            ? "Super Admin"
            : (roleValue as string).charAt(0).toUpperCase() +
            (roleValue as string).slice(1),
        icon: getRoleIcon(roleValue as string),
        color: getRoleColor(roleValue as string),
      }))
    : userRoles;

  // Get faceted unique values for banned status from the table
  const bannedColumn = table.getColumn("banned");
  const bannedFacets = bannedColumn?.getFacetedUniqueValues();

  // Create status filter options from faceted values
  const availableStatuses = bannedFacets
    ? Array.from(bannedFacets.keys())
      .filter((statusValue) => statusValue != null)
      .map((statusValue) => {
        const status = statusValue as string;
        const isBanned = status === "banned";
        return {
          value: status,
          label: isBanned ? "Banned" : "Active",
          icon: isBanned ? UserX : UserCheck,
          color: isBanned ? "text-red-600" : "text-green-600",
        };
      })
    : userStatuses;

  // Create organization filter options
  const organizationOptions = organizations.map((org) => ({
    value: org.id,
    label: org.name,
    icon: Building2,
    color: "text-blue-600",
  }));

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 w-[250px] pr-8 pl-8"
          />
          {(table.getState().globalFilter as string)?.length > 0 && (
            <button
              type="reset"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500 rounded-sm bg-red-200 p-0.5"
              onClick={() => table.setGlobalFilter("")}
              tabIndex={0}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {table.getColumn("role") && (
          <DataTableFacetedFilter
            column={table.getColumn("role")}
            title="Role"
            options={availableRoles}
          />
        )}
        {table.getColumn("banned") && (
          <DataTableFacetedFilter
            column={table.getColumn("banned")}
            title="Status"
            options={availableStatuses}
          />
        )}
        {organizationOptions.length > 0 && table.getColumn("organizations") && (
          <DataTableFacetedFilter
            column={table.getColumn("organizations")}
            title="Organization"
            options={organizationOptions}
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={handleExport}
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export
        </Button>
        <DataTableViewOptions table={table} />
        {onCreateUser && (
          <Button size="sm" className="h-8" onClick={onCreateUser}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Create User
          </Button>
        )}
      </div>
    </div>
  );
}
