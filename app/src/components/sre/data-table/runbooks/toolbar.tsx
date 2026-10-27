"use client";

import { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { DataTableViewOptions } from "@/components/ui/data-table-view-options";

interface RunbooksToolbarProps<TData> {
  table: Table<TData>;
  onAdd: () => void;
  isAddDisabled?: boolean;
  setupGuide?: ReactNode;
}

export function RunbooksToolbar<TData>({
  table,
  onAdd,
  isAddDisabled,
  setupGuide,
}: RunbooksToolbarProps<TData>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-[250px]">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            placeholder="Search query, connector, type..."
            className="h-8 pl-8"
            aria-label="Search saved queries"
          />
        </div>
        {table.getColumn("status") && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <DataTableViewOptions table={table} />
        {setupGuide}
        <Button
          onClick={onAdd}
          disabled={isAddDisabled}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add query
        </Button>
      </div>
    </div>
  );
}
