import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  title?: string;
  description?: string;
  showToolbar?: boolean;
  showPagination?: boolean;
}

// Consistent loading spinner for all tab content
export function TabLoadingSpinner({
  message = "Loading...",
}: {
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function TableSkeleton({
  rows = 3,
  columns = 4,
  title,
  description,
  showToolbar = true,
  showPagination = true,
}: TableSkeletonProps) {
  return (
    <div className="space-y-4">
      {/* Title and Description */}
      {(title || description) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <Skeleton className="h-8 w-48 mb-2" />}
            {description && <Skeleton className="h-4 w-96" />}
          </div>
        </div>
      )}

      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Skeleton className="h-9 w-64" /> {/* Search input */}
            <Skeleton className="h-9 w-32" /> {/* Filter button */}
            <Skeleton className="h-9 w-24" /> {/* View button */}
          </div>
          <div className="flex items-center space-x-2">
            <Skeleton className="h-9 w-28" /> {/* Action button */}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-t-lg border relative w-full">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b">
              {Array.from({ length: columns }).map((_, index) => (
                <TableHead
                  key={index}
                  className={`h-12 px-4 text-left align-middle font-semibold text-muted-foreground ${
                    index === 0 ? "rounded-tl-lg" : ""
                  } ${index === columns - 1 ? "rounded-tr-lg" : ""}`}
                >
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <TableCell key={colIndex} className="px-4 py-2.5 align-top">
                    <div className="py-2">
                      {colIndex === 0 ? (
                        // First column - typically has more complex content
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      ) : colIndex === columns - 1 ? (
                        // Last column - typically actions
                        <div className="flex items-center space-x-1">
                          <Skeleton className="h-8 w-8 rounded" />
                          <Skeleton className="h-8 w-8 rounded" />
                        </div>
                      ) : (
                        // Middle columns - simple content
                        <Skeleton className="h-4 w-24" />
                      )}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {showPagination && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" /> {/* Page info */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-20" /> {/* Previous button */}
            <Skeleton className="h-9 w-16" /> {/* Next button */}
          </div>
        </div>
      )}
    </div>
  );
}

interface AdminTableSkeletonProps {
  title?: string;
  description?: string;
  rows?: number;
  columns?: number;
}

export function AdminTableSkeleton({
  title,
  description,
  rows = 3,
  columns = 4,
}: AdminTableSkeletonProps) {
  return (
    <div className="space-y-4">
      {/* Title and Description */}
      {(title || description) && (
        <div className="flex items-center justify-between">
          <div>
            {title && <Skeleton className="h-8 w-32" />}
            {description && <Skeleton className="h-4 w-64" />}
          </div>
        </div>
      )}

      <TableSkeleton
        rows={rows}
        columns={columns}
        showToolbar={true}
        showPagination={true}
      />
    </div>
  );
}

export function StatsCardsSkeleton({
  cards = 6,
  columns = 4,
}: {
  cards?: number;
  columns?: number;
}) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-${columns}`}>
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="relative overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div>
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6">
          <div className="space-y-6">
            {/* Tabs skeleton */}
            <div className="flex space-x-1 rounded-lg bg-muted p-1 w-fit">
              {["Overview", "Users", "Organizations", "Queues"].map(
                (tab, i) => (
                  <Skeleton key={i} className="h-8 w-28 rounded-md" />
                )
              )}
            </div>

            {/* Overview content skeleton */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-7 w-36" />
                  <Skeleton className="h-4 w-80" />
                </div>
              </div>

              {/* Primary metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-7 w-16" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-8 w-8 rounded-lg" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Secondary metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-7 w-16" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-8 w-8 rounded-lg" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Detail cards */}
              <div className="grid gap-4 lg:grid-cols-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-44" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, j) => (
                          <div
                            key={j}
                            className="flex items-center justify-between py-2 border-b last:border-0"
                          >
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-12" />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function OrgAdminDashboardSkeleton() {
  return (
    <div>
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6">
          <div className="space-y-6">
            {/* Tabs skeleton */}
            <div className="flex space-x-1 rounded-lg bg-muted p-1 w-fit">
              {["Overview", "Projects", "Members", "Audit"].map((tab, i) => (
                <Skeleton key={i} className="h-8 w-24 rounded-md" />
              ))}
            </div>

            {/* Overview content skeleton */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-7 w-44" />
                  <Skeleton className="h-4 w-96" />
                </div>
              </div>

              {/* Primary metrics - 3 columns */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-7 w-16" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-8 w-8 rounded-lg" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Secondary metrics - 3 columns */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="relative overflow-hidden">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-7 w-16" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                        <Skeleton className="h-8 w-8 rounded-lg" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
