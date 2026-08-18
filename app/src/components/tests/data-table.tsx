"use client";

import type { ColumnDef, Row } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";

import { DataTable as GenericDataTable } from "@/components/sre/data-table/data-table";
import { prefetchTestPage } from "@/lib/prefetch-utils";

import { DataTableToolbar } from "./data-table-toolbar";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  meta?: {
    onDeleteTest?: (id: string) => void;
    [key: string]: unknown;
  };
}

export function DataTable<TData, TValue>(props: DataTableProps<TData, TValue>) {
  const queryClient = useQueryClient();

  return (
    <GenericDataTable
      {...props}
      entityLabel="tests"
      initialColumnVisibility={{ updatedAt: false }}
      meta={{
        globalFilterColumns: [
          "id",
          "title",
          "description",
          "type",
          "priority",
          "tags",
        ],
        ...props.meta,
      }}
      renderToolbar={(table) => <DataTableToolbar table={table} />}
      onRowPrefetch={(row) => {
        const id = (row.original as { id?: string }).id;
        if (id) prefetchTestPage(id, queryClient);
      }}
    />
  );
}
