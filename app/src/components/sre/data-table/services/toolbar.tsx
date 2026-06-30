import { Table } from "@tanstack/react-table";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";

interface ServicesToolbarProps<TData> {
  table: Table<TData>;
  onAdd: () => void;
}

export function ServicesToolbar<TData>({
  table,
  onAdd,
}: ServicesToolbarProps<TData>) {
  return (
    <div className="space-y-4">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">
            Manage services, ownership, telemetry names, and incident routing metadata
          </p>
        </div>
        <Button onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Register service
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:max-w-sm md:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search service, owner, tag..."
            value={table.getState().globalFilter ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="pl-9 h-8"
          />
        </div>

        <div className="flex items-center gap-2">
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
    </div>
  );
}
