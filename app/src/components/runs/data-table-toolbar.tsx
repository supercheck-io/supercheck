"use client";

import { Search, X } from "lucide-react";
import type { Table } from "@tanstack/react-table";

import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/jobs/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/jobs/data-table-faceted-filter";
import { runStatuses, triggerTypes } from "./data";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  return (
    <div className="flex items-center justify-between mb-4 -mt-2">
      <div className="flex items-center justify-between space-y-2">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Runs</h2>
          <p className="text-muted-foreground text-sm">
            View Job runs and their results
          </p>
        </div>
     
      </div>
      <div className="flex items-center space-x-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by all available fields..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 w-[400px] pr-8 pl-8"
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
            options={runStatuses}
          />
        )}
        {table.getColumn("trigger") && (
          <DataTableFacetedFilter
            column={table.getColumn("trigger")}
            title="Trigger"
            options={triggerTypes}
          />
        )}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}
