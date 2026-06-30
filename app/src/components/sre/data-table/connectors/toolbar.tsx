"use client";

import { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link2, Plus, Search } from "lucide-react";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";

interface ConnectorsToolbarProps<TData> {
  table: Table<TData>;
  onAddConnector: () => void;
  onAddBinding: () => void;
}

export function ConnectorsToolbar<TData>({
  table,
  onAddConnector,
  onAddBinding,
}: ConnectorsToolbarProps<TData>) {
  return (
    <div className="space-y-4 mb-4">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Evidence connectors</h2>
          <p className="text-sm text-muted-foreground">
            Connect read-only code, metrics, logs, traces, and infrastructure evidence to investigations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onAddBinding}>
            <Link2 className="mr-2 h-4 w-4" />
            AI SRE context links
          </Button>
          <Button onClick={onAddConnector}>
            <Plus className="mr-2 h-4 w-4" />
            Add connector
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative md:max-w-sm md:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search connectors..."
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="pl-9"
            aria-label="Search connectors"
          />
        </div>
        {table.getColumn("type") && (
          <DataTableFacetedFilter
            column={table.getColumn("type")}
            title="Type"
            options={[
              { value: "github", label: "GitHub" },
              { value: "kubernetes", label: "Kubernetes" },
              { value: "prometheus", label: "Prometheus" },
              { value: "grafana", label: "Grafana" },
              { value: "sentry", label: "Sentry" },
              { value: "datadog", label: "Datadog" },
              { value: "elasticsearch", label: "Elasticsearch" }
            ]}
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
              { value: "disabled", label: "Disabled" }
            ]}
          />
        )}

      </div>
    </div>
  );
}
