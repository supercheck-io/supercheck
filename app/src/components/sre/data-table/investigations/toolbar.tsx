"use client";

import { Search } from "lucide-react";
import { Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { Badge } from "@/components/ui/badge";

const statusOptions = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "timed_out", label: "Timed out" },
  { value: "aborted", label: "Aborted" },
];

const agentOptions = [
  { value: "triage", label: "Triage" },
  { value: "investigation", label: "Investigation" },
  { value: "background", label: "Background" },
  { value: "sre_ai", label: "Copilot" },
];

interface InvestigationsToolbarProps<TData> {
  table: Table<TData>;
}

export function InvestigationsToolbar<TData>({ table }: InvestigationsToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0 || !!table.getState().globalFilter;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search service, root cause, severity, model..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="pl-9 h-10 lg:w-[250px]"
          />
        </div>

        {table.getColumn("status") && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title="Status"
            options={statusOptions}
          />
        )}

        {table.getColumn("agentType") && (
          <DataTableFacetedFilter
            column={table.getColumn("agentType")}
            title="Agent"
            options={agentOptions}
          />
        )}

        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
            className="h-10 px-2 lg:px-3"
          >
            Clear
          </Button>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Badge variant="secondary" className="rounded-full">
          {table.getFilteredRowModel().rows.length} visible
        </Badge>
      </div>
    </div>
  );
}
