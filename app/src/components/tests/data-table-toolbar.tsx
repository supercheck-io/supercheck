import type { Table } from "@tanstack/react-table";
import { PlusIcon, X, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "./data-table-view-options";
import { useRouter } from "next/navigation";

import { types, priorities } from "./data";

import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableTagFilter } from "./data-table-tag-filter";
import { useTestPermissions } from "@/hooks/use-rbac-permissions";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const router = useRouter();
  const { canCreateTest } = useTestPermissions();

  return (
    <div className="flex items-center justify-between mb-4 -mt-2">
      <div className="flex items-center justify-between space-y-2">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Tests</h2>
          <p className="text-muted-foreground text-sm">
            Manage tests and their configurations
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
        <Button
          onClick={() => router.push("/playground?scriptType=browser")}
          disabled={!canCreateTest}
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Create Test
        </Button>
      </div>
    </div>
  );
}
