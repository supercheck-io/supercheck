import { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";

interface ServicesToolbarProps<TData> {
  table: Table<TData>;
  onAdd?: () => void;
  setupGuide?: ReactNode;
}

export function ServicesToolbar<TData>({
  table,
  onAdd,
  setupGuide,
}: ServicesToolbarProps<TData>) {
  return (
    <div className="mb-4 -mt-2 space-y-4">
      {/* Title and actions share one row, as on the Incidents page; search and filters sit below. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold">Services</h1>
          <p className="text-sm text-muted-foreground">
            Link monitors and jobs to services for investigation context.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {setupGuide}
          {onAdd && (
            <Button onClick={onAdd} data-testid="add-service-btn">
              <Plus className="mr-2 h-4 w-4" />
              Add service
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[250px]">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search service, owner, tag..."
            value={table.getState().globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 pl-8 pr-8"
            aria-label="Search services"
          />
          {table.getState().globalFilter && (
            <button
              type="button"
              aria-label="Clear service search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => table.setGlobalFilter("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {table.getColumn("tier") && (
          <DataTableFacetedFilter
            column={table.getColumn("tier")}
            title="Tier"
            options={[
              { label: "Tier 1", value: "1" },
              { label: "Tier 2", value: "2" },
              { label: "Tier 3", value: "3" },
              { label: "Tier 4", value: "4" },
            ]}
          />
        )}
        {table.getColumn("status") && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title="Status"
            options={[
              { label: "Active", value: "active" },
              { label: "Deprecated", value: "deprecated" },
              { label: "Merged", value: "merged" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
