"use client";

import { Table } from "@tanstack/react-table";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RunbooksToolbarProps<TData> {
  table: Table<TData>;
  onAdd: () => void;
  isAddDisabled?: boolean;
}

export function RunbooksToolbar<TData>({ table, onAdd, isAddDisabled }: RunbooksToolbarProps<TData>) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Diagnostic Recipes</h2>
          <p className="text-sm text-muted-foreground">Prepare approved read-only recipes responders can reuse during investigations.</p>
        </div>
        <Button onClick={onAdd} disabled={isAddDisabled}>
          <Plus className="mr-2 h-4 w-4" />
          Add recipe
        </Button>
      </div>
      <div className="flex items-center">
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={(table.getState().globalFilter as string) ?? ""}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            placeholder="Search recipe, connector, type..."
            className="pl-9"
            aria-label="Search diagnostic recipes"
          />
        </div>
      </div>
    </div>
  );
}
