import type { Table } from "@tanstack/react-table";
import { X, Search, CheckCircle, Archive, XCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";

import { projectStatuses } from "./project-data";

interface ProjectTableToolbarProps<TData> {
  table: Table<TData>;
  onCreateProject: () => void;
  canCreateProjects?: boolean;
}

export function ProjectTableToolbar<TData>({
  table,
  onCreateProject,
  canCreateProjects = false,
}: ProjectTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  // Get faceted unique values for status from the table
  const statusColumn = table.getColumn("status");
  const statusFacets = statusColumn?.getFacetedUniqueValues();
  
  // Create status filter options from faceted values with proper icons
  const getStatusIcon = (status: string) => {
    if (!status || typeof status !== 'string') return CheckCircle;
    switch (status) {
      case 'active': return CheckCircle;
      case 'archived': return Archive;
      case 'deleted': return XCircle;
      default: return CheckCircle;
    }
  };
  
  const getStatusColor = (status: string) => {
    if (!status || typeof status !== 'string') return 'text-gray-600';
    switch (status) {
      case 'active': return 'text-green-600';
      case 'archived': return 'text-yellow-600';
      case 'deleted': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };
  
  const availableStatuses = statusFacets ? 
    Array.from(statusFacets.keys())
      .filter(statusValue => statusValue != null)
      .map(statusValue => ({
        value: statusValue as string,
        label: (statusValue as string).charAt(0).toUpperCase() + (statusValue as string).slice(1),
        icon: getStatusIcon(statusValue as string),
        color: getStatusColor(statusValue as string),
      })) : 
    projectStatuses;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
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
        <Button onClick={onCreateProject} disabled={!canCreateProjects}>
          <Plus className="h-4 w-4 mr-2" />
          Create Project
        </Button>
      </div>
    </div>
  );
}