import type { Table } from "@tanstack/react-table";

import { ListPagination } from "@/components/admin/list-pagination";

interface AdminDataTablePaginationProps<TData> {
  table: Table<TData>;
  itemName?: string;
}

export function AdminDataTablePagination<TData>({
  table,
  itemName = "items",
}: AdminDataTablePaginationProps<TData>) {
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
