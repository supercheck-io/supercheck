import type { Table } from "@tanstack/react-table";
import { X, Search, UserPlus, Crown, Shield, User, Eye, CheckCircle, Clock, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";

import { memberRoles, memberStatuses } from "./member-data";

interface MemberTableToolbarProps<TData> {
  table: Table<TData>;
  onInviteMember: () => void;
  canInviteMembers?: boolean;
}

export function MemberTableToolbar<TData>({
  table,
  onInviteMember,
  canInviteMembers = false,
}: MemberTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  // Get faceted unique values for roles from the table
  const roleColumn = table.getColumn("role");
  const roleFacets = roleColumn?.getFacetedUniqueValues();
  
  // Create role filter options from faceted values with proper icons
  const getRoleIcon = (role: string) => {
    if (!role || typeof role !== 'string') return User;
    switch (role) {
      case 'org_owner': return Crown;
      case 'org_admin': return Shield;
      case 'project_editor': return User;
      case 'project_viewer': return Eye;
      default: return User;
    }
  };
  
  const getRoleColor = (role: string) => {
    if (!role || typeof role !== 'string') return 'text-gray-600';
    switch (role) {
      case 'org_owner': return 'text-purple-600';
      case 'org_admin': return 'text-blue-600';
      case 'project_editor': return 'text-green-600';
      case 'project_viewer': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };
  
  const availableRoles = roleFacets ? 
    Array.from(roleFacets.keys())
      .filter(roleValue => roleValue != null)
      .map(roleValue => ({
        value: roleValue as string,
        label: (roleValue as string).charAt(0).toUpperCase() + (roleValue as string).slice(1),
        icon: getRoleIcon(roleValue as string),
        color: getRoleColor(roleValue as string),
      })) : 
    memberRoles;

  // Get faceted unique values for status from the table
  const statusColumn = table.getColumn("status");
  const statusFacets = statusColumn?.getFacetedUniqueValues();
  
  // Create status filter options from faceted values
  const getStatusIcon = (status: string) => {
    if (!status || typeof status !== 'string') return CheckCircle;
    switch (status) {
      case 'active': return CheckCircle;
      case 'pending': return Clock;
      case 'expired': return XCircle;
      default: return CheckCircle;
    }
  };
  
  const getStatusColor = (status: string) => {
    if (!status || typeof status !== 'string') return 'text-gray-600';
    switch (status) {
      case 'active': return 'text-green-600';
      case 'pending': return 'text-yellow-600';
      case 'expired': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };
  
  const getStatusLabel = (status: string) => {
    if (!status || typeof status !== 'string') return 'Unknown';
    switch (status) {
      case 'active': return 'Active';
      case 'pending': return 'Pending Invitation';
      case 'expired': return 'Expired Invitation';
      default: return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };
  
  const availableStatuses = statusFacets ? 
    Array.from(statusFacets.keys())
      .filter(statusValue => statusValue != null)
      .map(statusValue => ({
        value: statusValue as string,
        label: getStatusLabel(statusValue as string),
        icon: getStatusIcon(statusValue as string),
        color: getStatusColor(statusValue as string),
      })) : 
    memberStatuses;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search members and invitations..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 w-[300px] pr-8 pl-8"
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
        {table.getColumn("status") && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title="Status"
            options={availableStatuses}
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
        <DataTableViewOptions table={table} />
        <Button onClick={onInviteMember} disabled={!canInviteMembers}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite Member
        </Button>
      </div>
    </div>
  );
}