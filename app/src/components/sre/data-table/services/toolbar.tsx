import { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";

interface ServicesToolbarProps<TData> {
  table: Table<TData>;
  onAdd: () => void;
  setupGuide?: ReactNode;
}

export function ServicesToolbar<TData>({
  table,
  onAdd,
  setupGuide,
}: ServicesToolbarProps<TData>) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search service, owner, tag..."
            value={table.getState().globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 pl-9"
            aria-label="Search services"
          />
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
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {setupGuide}
        <Button onClick={onAdd} className="w-full sm:w-auto" data-testid="add-service-btn">
          <Plus className="mr-2 h-4 w-4" />
          Add service
        </Button>
      </div>
    </div>
  );
}
