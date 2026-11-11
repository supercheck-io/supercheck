import type { Table } from "@tanstack/react-table";

import { ListPagination } from "./list-pagination";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  itemName?: string;
}

export function DataTablePagination<TData>({
  table,
  itemName = "items",
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  return (
    <ListPagination
      total={table.getRowCount()}
      itemName={itemName}
      pageIndex={pageIndex}
      pageSize={pageSize}
      pageCount={table.getPageCount()}
      onPageChange={(index) => table.setPageIndex(index)}
      onPageSizeChange={(size) => table.setPageSize(size)}
    />
  );
}
