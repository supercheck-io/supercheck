"use client";

import { Search, X } from "lucide-react";
import { type Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/ui/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

  const typeOptions = [
    {
      label: "Variable",
      value: "variable",
    },
    {
      label: "Secret",
      value: "secret",
    },
    {
      label: "File",
      value: "file",
    },
  ];

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-[250px]">
        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by all available fields..."
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          className="h-8 pl-8"
        />
      </div>
      {table.getColumn("type") && (
        <DataTableFacetedFilter
          column={table.getColumn("type")}
          title="Type"
          options={typeOptions}
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
      <DataTableViewOptions table={table} />
    </div>
  );
}
