"use client";

import { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2, Plus, Search } from "lucide-react";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { SRE_CONNECTOR_CATALOG } from "@/components/sre/connectors/connector-catalog";

interface ConnectorsToolbarProps<TData> {
  table: Table<TData>;
  onAddConnector: () => void;
  onAddBinding: () => void;
  setupGuide?: ReactNode;
}

export function ConnectorsToolbar<TData>({
  table,
  onAddConnector,
  onAddBinding,
  setupGuide,
}: ConnectorsToolbarProps<TData>) {
  const typeColumn = table.getColumn("type");
  const availableTypeValues = typeColumn?.getFacetedUniqueValues();
  const typeOptions = SRE_CONNECTOR_CATALOG.filter(
    ({ value }) => !availableTypeValues || availableTypeValues.has(value),
  ).map(({ value, label }) => ({ value, label }));

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search connectors..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 pl-9"
            aria-label="Search connectors"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {typeColumn && typeOptions.length > 0 && (
            <DataTableFacetedFilter
              column={typeColumn}
              title="Type"
              options={typeOptions}
            />
          )}
          {table.getColumn("status") && (
            <DataTableFacetedFilter
              column={table.getColumn("status")}
              title="Status"
              options={[
                { value: "valid", label: "Valid" },
                { value: "configured", label: "Configured" },
                { value: "unreachable", label: "Unreachable" },
                { value: "missing_credentials", label: "Missing credentials" },
                { value: "disabled", label: "Disabled" },
              ]}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" onClick={onAddBinding}>
          <Link2 className="mr-2 h-4 w-4" />
          Context links
        </Button>
        {setupGuide}
        <Button onClick={onAddConnector}>
          <Plus className="mr-2 h-4 w-4" />
          Add connector
        </Button>
      </div>
    </div>
  );
}
