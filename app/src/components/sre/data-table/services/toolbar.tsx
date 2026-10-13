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
    <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 lg:max-w-sm lg:shrink-0">
        <h2 className="text-2xl font-semibold">Services</h2>
        <p className="text-sm text-muted-foreground">
          Link monitors and jobs to services for investigation context.
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
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

        <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-wrap items-center gap-2">
          {setupGuide}
          {onAdd && (
            <Button
              onClick={onAdd}
              className="w-full sm:w-auto"
              data-testid="add-service-btn"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add service
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
