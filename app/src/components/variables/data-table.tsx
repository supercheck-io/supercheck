import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  TableMeta,
  type Row,
} from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  meta?: {
    onDeleteVariable?: (id: string) => void;
    onEditVariable?: (variable: TData) => void;
    onCreateVariable?: () => void;
    canManage?: boolean;
    [key: string]: unknown;
  };
}

// Define the extended meta type locally
interface ExtendedTableMeta<TData> extends TableMeta<TData> {
  globalFilterColumns?: string[];
  onDeleteVariable?: (id: string) => void;
  onEditVariable?: (variable: TData) => void;
  onCreateVariable?: () => void;
  canManage?: boolean;
}

// Custom global filter function for variables table
function variableGlobalFilterFn(row: Row<unknown>, _columnId: string, filterValue: string) {
  if (!filterValue) return true;
  const search = String(filterValue).toLowerCase();
  // Use default columns for filtering
  const columns = ["key", "description", "value"];
  const result = columns.some((id: string) => {
    const value = row.getValue(id);
    if (typeof value === "string" || typeof value === "number") {
      return String(value).toLowerCase().includes(search);
    }
    return false;
  });
  
  // Also search in type (Variable/Secret)
  if (!result) {
    const isSecret = row.getValue("isSecret") as boolean;
    const type = isSecret ? "secret" : "variable";
    return type.includes(search);
  }
  
  return result;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  onRowClick,
  meta,
}: DataTableProps<TData, TValue>) {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [mounted, setMounted] = React.useState(false);

  // Set mounted to true after initial render
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
    }, 0);
    
    return () => {
      clearTimeout(timer);
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetSorting = React.useCallback((updaterOrValue: SortingState | ((old: SortingState) => SortingState)) => {
    if (mounted) {
      if (typeof updaterOrValue === 'function') {
        setSorting(updaterOrValue);
      } else {
        setSorting(updaterOrValue);
      }
    }
  }, [mounted]);
  
  const safeSetColumnFilters = React.useCallback((updaterOrValue: ColumnFiltersState | ((old: ColumnFiltersState) => ColumnFiltersState)) => {
    if (mounted) {
      if (typeof updaterOrValue === 'function') {
        setColumnFilters(updaterOrValue);
      } else {
        setColumnFilters(updaterOrValue);
      }
    }
  }, [mounted]);
  
  const safeSetColumnVisibility = React.useCallback((updaterOrValue: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
    if (mounted) {
      if (typeof updaterOrValue === 'function') {
        setColumnVisibility(updaterOrValue);
      } else {
        setColumnVisibility(updaterOrValue);
      }
    }
  }, [mounted]);
  
  const safeSetGlobalFilter = React.useCallback((updaterOrValue: string | ((old: string) => string)) => {
    if (mounted) {
      if (typeof updaterOrValue === 'function') {
        setGlobalFilter(updaterOrValue);
      } else {
        setGlobalFilter(updaterOrValue);
      }
    }
  }, [mounted]);

  const table = useReactTable({
    data,
    columns,
    initialState: {
      pagination: {
        pageSize: 12,
      },
      columnVisibility: {
        updatedAt: false,
      },
    },
    state: mounted ? {
      sorting,
      columnVisibility,
      columnFilters,
      globalFilter,
    } : {
      sorting: [],
      columnVisibility: { updatedAt: false },
      columnFilters: [],
      globalFilter: "",
    },
    enableRowSelection: false,
    onSortingChange: safeSetSorting,
    onColumnFiltersChange: safeSetColumnFilters,
    onColumnVisibilityChange: safeSetColumnVisibility,
    onGlobalFilterChange: safeSetGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    globalFilterFn: variableGlobalFilterFn,
    meta: {
      ...meta,
      globalFilterColumns: ["key", "description", "value"],
    } as ExtendedTableMeta<TData>,
  });

  // Use useEffect to reset pagination after the component has mounted
  React.useEffect(() => {
    // Only reset if there's data and the component is mounted
    if (data.length > 0 && mounted) {
      // Use setTimeout to ensure this runs after the current render cycle
      setTimeout(() => {
        if (mounted) {
          table.resetPageIndex(true);
        }
      }, 0);
    }
  }, [data, table, mounted]);

  // Show skeleton loader while not mounted
  if (!mounted) {
    return (
      <div className="space-y-4">
        <DataTableSkeleton columns={columns.length} rows={2} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataTableToolbar table={table} />
      <div className="rounded-t-lg border relative">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  <div className="flex justify-center items-center space-x-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Loading data...
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  );
}