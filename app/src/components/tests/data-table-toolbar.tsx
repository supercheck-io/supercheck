import type { Table } from "@tanstack/react-table";
import { X, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "./data-table-view-options";

import { types, priorities } from "./data";

import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableTagFilter } from "./data-table-tag-filter";



interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-[250px]">
        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by all available fields..."
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          className="h-8 pr-8 pl-8"
          data-testid="search-input"
        />
        {(table.getState().globalFilter as string)?.length > 0 && (
          <button
            type="reset"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => table.setGlobalFilter("")}
            tabIndex={0}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {table.getColumn("type") && (
        <DataTableFacetedFilter
          column={table.getColumn("type")}
          title="Type"
          options={types}
        />
      )}
      {table.getColumn("priority") && (
        <DataTableFacetedFilter
          column={table.getColumn("priority")}
          title="Priority"
          options={priorities}
        />
      )}
      {table.getColumn("tags") && (
        <DataTableTagFilter
          column={table.getColumn("tags")}
          title="Tags"
        />
      )}
      <DataTableViewOptions table={table} />

    </div>
  );
}
