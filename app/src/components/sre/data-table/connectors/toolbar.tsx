"use client";

import { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Link2,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  SquareLibrary,
} from "lucide-react";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { SRE_CONNECTOR_CATALOG } from "@/components/sre/connectors/connector-catalog";

interface ConnectorsToolbarProps<TData> {
  table: Table<TData>;
  onAddConnector: () => void;
  onAddBinding: () => void;
  onOpenSetupGuide: () => void;
  onOpenSavedQueries?: () => void;
}

export function ConnectorsToolbar<TData>({
  table,
  onAddConnector,
  onAddBinding,
  onOpenSetupGuide,
  onOpenSavedQueries,
}: ConnectorsToolbarProps<TData>) {
  const typeColumn = table.getColumn("type");
  const availableTypeValues = typeColumn?.getFacetedUniqueValues();
  const typeOptions = SRE_CONNECTOR_CATALOG.filter(
    ({ value }) => !availableTypeValues || availableTypeValues.has(value),
  ).map(({ value, label }) => ({ value, label }));

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-[250px]">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search connectors..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 pl-8"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <MoreHorizontal className="mr-2 h-4 w-4" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpenSetupGuide}>
              <ListChecks className="mr-2 h-4 w-4" />
              Setup guide
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAddBinding}>
              <Link2 className="mr-2 h-4 w-4" />
              Context links
            </DropdownMenuItem>
            {onOpenSavedQueries && (
              <DropdownMenuItem onSelect={onOpenSavedQueries}>
                <SquareLibrary className="mr-2 h-4 w-4" />
                Saved queries
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={onAddConnector}>
          <Plus className="mr-2 h-4 w-4" />
          Add connector
        </Button>
      </div>
    </div>
  );
}
