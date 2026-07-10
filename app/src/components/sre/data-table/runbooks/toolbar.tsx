"use client";

import { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RunbooksToolbarProps<TData> {
  table: Table<TData>;
  onAdd: () => void;
  isAddDisabled?: boolean;
  setupGuide?: ReactNode;
}

export function RunbooksToolbar<TData>({
  table,
  onAdd,
  isAddDisabled,
  setupGuide,
}: RunbooksToolbarProps<TData>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          placeholder="Search recipe, connector, type..."
          className="h-8 pl-9"
          aria-label="Search diagnostic recipes"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {setupGuide}
        <Button
          onClick={onAdd}
          disabled={isAddDisabled}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add recipe
        </Button>
      </div>
    </div>
  );
}
