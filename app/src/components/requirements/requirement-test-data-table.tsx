"use client"

import * as React from "react"
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
} from "@tanstack/react-table"
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Search, X, Filter } from "lucide-react"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { LinkedTest } from "@/actions/requirements"

interface RequirementTestDataTableProps {
    columns: ColumnDef<LinkedTest>[]
    data: LinkedTest[]
    className?: string
    onRowClick?: (id: string) => void;
}

export function RequirementTestDataTable({
    columns,
    data,
    className,
    onRowClick,
}: RequirementTestDataTableProps) {
    const [rowSelection, setRowSelection] = React.useState({})
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [sorting, setSorting] = React.useState<SortingState>([])
    const [globalFilter, setGlobalFilter] = React.useState("")
    const [searchValue, setSearchValue] = React.useState("")

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setGlobalFilter(searchValue)
        }, 100)

        return () => clearTimeout(timer)
    }, [searchValue])

    const globalFilterFn = React.useCallback(
        (row: Row<LinkedTest>, columnId: string, filterValue: string) => {
            const test = row.original;
            const searchTerm = filterValue.toLowerCase().trim();

            if (!searchTerm) return true;

            if (test.id?.toLowerCase().includes(searchTerm)) return true;
            if (test.name?.toLowerCase().includes(searchTerm)) return true;
            if (test.type?.toLowerCase().includes(searchTerm)) return true;

            if (test.tags && Array.isArray(test.tags)) {
                const tagMatch = test.tags.some((tag) =>
                    tag.name?.toLowerCase().includes(searchTerm)
                );
                if (tagMatch) return true;
            }

            if (test.description?.toLowerCase().includes(searchTerm)) return true;

            return false;
        },
        []
    );

    const table = useReactTable({
        data,
        columns,
        initialState: {
            pagination: {
                pageSize: 10,
            },
        },
        state: {
            sorting,
            columnVisibility,
            rowSelection,
            columnFilters,
            globalFilter,
        },
        enableRowSelection: false,
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        globalFilterFn: globalFilterFn,
    })

    const isFiltered = table.getState().columnFilters.length > 0 || !!table.getState().globalFilter

    return (
        <div className={cn("w-full space-y-4", className)}>
            {/* Toolbar */}
            <div className="flex items-center justify-between space-x-2">
                <div className="flex items-center space-x-2 flex-1">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter tests by ID, name, type, tags, or description..."
                            value={searchValue}
                            onChange={(event) => setSearchValue(event.target.value)}
                            className="pl-8 w-full md:w-[450px]"
                        />
                    </div>

                    {isFiltered && (
                        <div className="flex items-center space-x-2 ml-4">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <div className="text-sm text-muted-foreground">
                                {table.getFilteredRowModel().rows.length} of {table.getCoreRowModel().rows.length} tests
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    table.resetColumnFilters()
                                    table.setGlobalFilter("")
                                    setSearchValue("")
                                }}
                                className="h-8"
                            >
                                Clear
                                <X className="ml-1 h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
            {/* Table */}
            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id} className="sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className={cn(onRowClick && "hover:bg-muted/50 cursor-pointer")}
                                    onClick={() => onRowClick?.(row.original.id)}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="py-3">
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No linked tests found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {table.getRowModel().rows.length > 0 && (
                <div className="flex items-center justify-between px-2">
                    <div className="flex-1 text-sm text-muted-foreground">
                        Total Tests: {table.getFilteredRowModel().rows.length}
                    </div>
                    <div className="flex items-center space-x-6 lg:space-x-8">
                        <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium">Rows per page</p>
                            <select
                                value={table.getState().pagination.pageSize}
                                onChange={(e) => {
                                    table.setPageSize(Number(e.target.value))
                                }}
                                className="h-8 w-[70px] rounded border border-input bg-background px-2 py-1 text-sm"
                            >
                                {[10, 20, 30, 40, 50].map((pageSize) => (
                                    <option key={pageSize} value={pageSize}>
                                        {pageSize}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                            Page {table.getState().pagination.pageIndex + 1} of{" "}
                            {table.getPageCount()}
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.setPageIndex(0)}
                                disabled={!table.getCanPreviousPage()}
                            >
                                <span className="sr-only">Go to first page</span>
                                <ChevronFirst className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.previousPage()}
                                disabled={!table.getCanPreviousPage()}
                            >
                                <span className="sr-only">Go to previous page</span>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.nextPage()}
                                disabled={!table.getCanNextPage()}
                            >
                                <span className="sr-only">Go to next page</span>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                                disabled={!table.getCanNextPage()}
                            >
                                <span className="sr-only">Go to last page</span>
                                <ChevronLast className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
