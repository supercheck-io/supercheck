import * as React from "react";
import type { Column } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  // Function to handle cycling through sort states
  const cycleSorting = () => {
    // Order: unsorted -> ascending -> descending -> unsorted
    const currentSort = column.getIsSorted();
    if (currentSort === false) {
      // Currently unsorted, set to ascending
      column.toggleSorting(false);
    } else if (currentSort === "asc") {
      // Currently ascending, set to descending
      column.toggleSorting(true);
    } else {
      // Currently descending, clear sorting
      column.clearSorting();
    }
  };

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "-ml-3 h-8",
          column.getIsSorted() && "bg-muted font-semibold"
        )}
        onClick={cycleSorting}
      >
        <span>{title}</span>
        {column.getIsSorted() === "desc" ? (
          <ArrowDown className="ml-2 h-4 w-4 text-primary" />
        ) : column.getIsSorted() === "asc" ? (
          <ArrowUp className="ml-2 h-4 w-4 text-primary" />
        ) : (
          <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}