"use client";

import type { Table } from "@tanstack/react-table";
import { Plus } from "lucide-react";

import { AdminListToolbar } from "@/components/admin/admin-list-toolbar";
import { Button } from "@/components/ui/button";

const STATUS_OPTIONS = ["pending", "connected", "disconnected", "unhealthy", "disabled"].map(
  (value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }),
);
const SCOPE_OPTIONS = ["Project", "Organization"].map((value) => ({
  value,
  label: value,
}));

export function PrivateAgentsToolbar<TData>({
  table,
  onRegister,
}: {
  table: Table<TData>;
  onRegister: () => void;
}) {
  const networks = Array.from(
    table.getColumn("networkLabel")?.getFacetedUniqueValues().keys() ?? [],
  )
    .filter((value): value is string => typeof value === "string")
    .map((value) => ({ value, label: value }));

  return (
    <AdminListToolbar
      table={table}
      searchPlaceholder="Search agents..."
      facets={[
        { columnId: "status", title: "Status", options: STATUS_OPTIONS },
        { columnId: "scope", title: "Scope", options: SCOPE_OPTIONS },
        { columnId: "networkLabel", title: "Network", options: networks },
      ]}
    >
      <Button onClick={onRegister}>
        <Plus className="mr-2 h-4 w-4" />
        Register agent
      </Button>
    </AdminListToolbar>
  );
}
