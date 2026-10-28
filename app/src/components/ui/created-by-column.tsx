"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { UserCell } from "@/components/ui/user-cell";

export type CreatedByFields = { createdByName?: string | null; createdByImage?: string | null };

/** The "Created by" list column. Every list uses this so owners look and filter the same everywhere. */
export function createdByColumn<T extends CreatedByFields>(): ColumnDef<T> {
  return {
    id: "createdBy",
    accessorFn: (row) => row.createdByName ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created by" />,
    cell: ({ row }) => (
      <UserCell
        name={row.original.createdByName}
        image={row.original.createdByImage}
        emptyLabel="Unknown"
        className="h-8 w-[150px]"
      />
    ),
  };
}
