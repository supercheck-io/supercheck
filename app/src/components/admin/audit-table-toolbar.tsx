import type { Table } from "@tanstack/react-table";
import { X, Search, User, Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";

import { auditActions } from "./audit-data";

interface AuditTableToolbarProps<TData> {
  table: Table<TData>;
  availableUsers?: { name: string; email?: string }[];
}

export function AuditTableToolbar<TData>({
  table,
  availableUsers = [],
}: AuditTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  // Get faceted unique values for actions from the table
  const actionColumn = table.getColumn("action");
  const actionFacets = actionColumn?.getFacetedUniqueValues();
  
  // Create action filter options from faceted values with Activity icon
  const availableAuditActions = actionFacets ? 
    Array.from(actionFacets.keys()).map(actionValue => ({
      value: actionValue as string,
      label: actionValue as string,
      icon: Activity,
      color: 'text-gray-600',
    })) : 
    auditActions;

  // Get faceted unique values for users from the table
  const userColumn = table.getColumn("user");
  const userFacets = userColumn?.getFacetedUniqueValues();
  
  // Create user filter options from faceted values
  const userFilterOptions = userFacets ? 
    Array.from(userFacets.keys()).map(userName => ({
      value: userName as string,
      label: userName as string,
      icon: User,
      color: userName === 'System' ? 'text-gray-600' : 'text-blue-600',
    })) : 
    availableUsers.map(user => ({
      value: user.name || 'System',
      label: user.name || 'System',
      icon: User,
      color: 'text-blue-600',
    }));

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search audit logs..."
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
        {table.getColumn("action") && (
          <DataTableFacetedFilter
            column={table.getColumn("action")}
            title="Action"
            options={availableAuditActions}
          />
        )}
        {table.getColumn("user") && (
          <DataTableFacetedFilter
            column={table.getColumn("user")}
            title="User"
            options={userFilterOptions}
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
      </div>
    </div>
  );
}