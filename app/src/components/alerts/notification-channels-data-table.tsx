"use client";

import * as React from "react";
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getFacetedUniqueValues,
  type ColumnFiltersState,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  Row,
} from "@tanstack/react-table";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableViewOptions } from "./data-table-view-options";
import { notificationProviders, PAGING_SERVICE_NAMES } from "./data";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useFitPagination } from "@/hooks/use-fit-page-size";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { cn } from "@/lib/utils";
import { NotificationChannel } from "./notification-channels-schema";

// Define a more specific meta type
interface TableMeta {
  onEdit?: (channel: NotificationChannel) => void;
  onDelete?: (channel: NotificationChannel) => void;
  canEdit?: boolean;
  canDelete?: boolean;
  onTest?: (channel: NotificationChannel) => void;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  meta?: TableMeta;
}

export function NotificationChannelsDataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  onRowClick,
  meta,
}: DataTableProps<TData, TValue>) {
  const [mounted, setMounted] = React.useState(false);
  const { bodyRef, pagination, onPaginationChange } = useFitPagination(data.length);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({ id: false, createdAt: false });
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});

  // Set mounted to true after initial render
  React.useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetSorting = React.useCallback((sorting: SortingState | ((prev: SortingState) => SortingState)) => {
    if (mounted) {
      setSorting(sorting);
    }
  }, [mounted]);

  const safeSetColumnVisibility = React.useCallback((visibility: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    if (mounted) {
      setColumnVisibility(visibility);
    }
  }, [mounted]);

  const safeSetRowSelection = React.useCallback((selection: Record<string, boolean> | ((old: Record<string, boolean>) => Record<string, boolean>)) => {
    if (mounted) {
      setRowSelection(selection);
    }
  }, [mounted]);

  const table = useReactTable({
    data,
    columns,
    onPaginationChange,
    state: {
      pagination,
      sorting,
      columnVisibility,
      rowSelection,
      globalFilter,
      columnFilters,
    },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    // Search matches the title only; the Provider filter covers the type.
    globalFilterFn: (row, _id, value: string) => String((row.original as { name?: string }).name ?? "").toLowerCase().includes(value.trim().toLowerCase()),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    enableRowSelection: true,
    onRowSelectionChange: safeSetRowSelection,
    onSortingChange: safeSetSorting,
    onColumnVisibilityChange: safeSetColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: {
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

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="h-full flex-1 flex-col">
        <DataTableSkeleton columns={4} rows={3} />
      </div>
    );
  }

  // Offer only the providers this project has.
  const providerColumn = table.getAllLeafColumns().find((column) => column.id === "type");
  const present = providerColumn?.getFacetedUniqueValues() ?? new Map();
  const providerOptions = [
    ...notificationProviders.filter((p) => p.type !== "webhook").map((p) => ({ value: p.type as string, label: p.label })),
    ...Object.entries(PAGING_SERVICE_NAMES).map(([value, label]) => ({ value, label })),
    { value: "webhook", label: "Custom webhook" },
  ].filter((option) => present.has(option.value));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[300px]">
          <Search aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title..."
            aria-label="Search channels by title"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="h-8 pl-8 pr-8"
            data-testid="search-input"
          />
          {globalFilter && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setGlobalFilter("")}
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {providerColumn && <DataTableFacetedFilter column={providerColumn} title="Provider" options={providerOptions} />}
        <div className="ml-auto">
          <DataTableViewOptions table={table} />
        </div>
      </div>
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
          <TableBody ref={bodyRef}>
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
                    "h-[53px]",
                    onRowClick ? "hover:bg-muted cursor-pointer" : ""
                  )}
                  onClick={(e) => handleRowClick(e, row)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell 
                      key={cell.id}
                      className={cn(
                        "py-2.5",
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
      <DataTablePagination table={table} itemName="channels" />
    </div>
  );
} 