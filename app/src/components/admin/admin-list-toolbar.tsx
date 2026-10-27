import type { ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";

export type ToolbarFacet = {
  columnId: string;
  title: string;
  options: {
    label: string;
    value: string;
    icon?: React.ComponentType<{ className?: string }>;
    color?: string;
  }[];
};

/** Standard list toolbar: search, faceted filters, reset, view options, then page actions. */
export function AdminListToolbar<TData>({
  table,
  searchPlaceholder,
  facets = [],
  children,
}: {
  table: Table<TData>;
  searchPlaceholder: string;
  facets?: ToolbarFacet[];
  children?: ReactNode;
}) {
  const search = (table.getState().globalFilter as string) ?? "";
  const isFiltered = table.getState().columnFilters.length > 0 || search.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 w-[250px] pl-8 pr-8"
          />
          {search.length > 0 && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm bg-red-200 p-0.5 text-red-500"
              onClick={() => table.setGlobalFilter("")}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {facets.map(
          (facet) =>
            table.getColumn(facet.columnId) && (
              <DataTableFacetedFilter
                key={facet.columnId}
                column={table.getColumn(facet.columnId)}
                title={facet.title}
                options={facet.options}
              />
            ),
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <DataTableViewOptions table={table} />
        {children}
      </div>
    </div>
  );
}
