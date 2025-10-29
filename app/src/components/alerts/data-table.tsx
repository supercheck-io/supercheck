"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  Row,
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
import { notificationProviders } from "./data";
import { AlertHistory } from "./schema";

// Define a more specific meta type
interface TableMeta {
  globalFilterColumns?: string[];
  onDelete?: () => void;
}

// Custom global filter function for alerts table
function alertGlobalFilterFn(row: Row<AlertHistory>, _columnId: string, filterValue: string) {
  if (!filterValue) return true;
  const search = String(filterValue).toLowerCase();
  
  try {
    // Get the actual data from the row
    const rowData = row.original;
    
    if (!rowData) return false;
    
    // Check if any of the searchable fields contain the search term
    const searchableFields = [
      rowData.id,
      rowData.targetName,
      rowData.message,
      rowData.type,
      rowData.status,
      rowData.notificationProvider // Add notificationProvider to searchable fields
    ];
    
    // Check basic field matching
    const basicMatch = searchableFields.some(field => {
      if (typeof field === "string" || typeof field === "number") {
        return String(field).toLowerCase().includes(search);
      }
      return false;
    });
    
    if (basicMatch) return true;
    
    // Enhanced provider search logic
    if (rowData.notificationProvider && typeof rowData.notificationProvider === "string") {
      const providerString = rowData.notificationProvider.toLowerCase();
      
      // Direct string match
      if (providerString.includes(search)) return true;
      
      // Search through individual providers in comma-separated string
      const providers = providerString
        .split(',')
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);
      
      // Check if any provider matches the search term
      if (providers.some((provider: string) => provider.includes(search))) return true;
      
      // Enhanced provider label matching using actual provider configurations
      const searchTerm = search.trim();
      if (providers.some((provider: string) => {
        const cleanProvider = provider.trim();
        
        // Direct match
        if (cleanProvider === searchTerm) return true;
        
        // Find provider config and check label
        const providerConfig = notificationProviders.find(p => p.type === cleanProvider);
        if (providerConfig && providerConfig.label.toLowerCase().includes(searchTerm)) {
          return true;
        }
        
        // Check if search term matches provider type
        if (cleanProvider.includes(searchTerm)) return true;
        
        return false;
      })) return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error in global filter function:', error);
    return false;
  }
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  meta?: TableMeta;
}

export function DataTable<TData extends AlertHistory, TValue>({
  columns,
  data,
  isLoading,
  onRowClick,
  meta,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
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
  const safeSetRowSelection = React.useCallback((value: Record<string, boolean> | ((old: Record<string, boolean>) => Record<string, boolean>)) => {
    if (mounted) {
      setRowSelection(value);
    }
  }, [mounted]);
  
  const safeSetSorting = React.useCallback((value: SortingState | ((old: SortingState) => SortingState)) => {
    if (mounted) {
      setSorting(value);
    }
  }, [mounted]);
  
  const safeSetColumnFilters = React.useCallback((value: ColumnFiltersState | ((old: ColumnFiltersState) => ColumnFiltersState)) => {
    if (mounted) {
      setColumnFilters(value);
    }
  }, [mounted]);
  
  const safeSetColumnVisibility = React.useCallback((value: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
    if (mounted) {
      setColumnVisibility(value);
    }
  }, [mounted]);
  
  const safeSetGlobalFilter = React.useCallback((value: string | ((old: string) => string)) => {
    if (mounted) {
      setGlobalFilter(value);
    }
  }, [mounted]);

  const table = useReactTable({
    data,
    columns,
    initialState: {
      pagination: {
        pageSize: 12,
      },
    },
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
    },
    enableRowSelection: true,
    onRowSelectionChange: safeSetRowSelection,
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
    globalFilterFn: alertGlobalFilterFn,
    meta: {
      globalFilterColumns: ["id", "targetName", "message", "type", "status", "notificationProvider"],
      ...meta,
    } as TableMeta,
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

  // Handle row clicks while checking for action column clicks
  const handleRowClick = (e: React.MouseEvent, row: Row<TData>) => {
    const target = e.target as HTMLElement;
    
    // Check if the click was inside or on a dropdown menu or button
    if (
      target.closest('.actions-column') || 
      target.closest('[role="menuitem"]') || 
      target.closest('[role="menu"]') || 
      target.closest('button')
    ) {
      return; // Don't process row click
    }
    
    // Process row click if handler provided
    if (onRowClick) {
      onRowClick(row);
    }
  };

  // Don't render the table until the component is mounted
  if (!mounted) {
    return <DataTableSkeleton columns={4} rows={3} />;
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
                    <TableHead key={header.id}>
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
                  className={cn(
                    onRowClick ? "hover:bg-muted cursor-pointer" : ""
                  )}
                  onClick={(e) => handleRowClick(e, row)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell 
                      key={cell.id}
                      className={cn(
                        "py-2",
                        cell.column.id === "actions" ? "actions-column" : ""
                      )}
                    >
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
