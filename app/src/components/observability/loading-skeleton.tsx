/**
 * Loading Skeletons for Observability Components
 * Minimal, professional loading states
 */

"use client";

import { cn } from "~/lib/utils";

export function TraceListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border rounded-lg p-4 animate-pulse">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 bg-muted rounded" />
              <div className="h-3 w-1/3 bg-muted rounded" />
            </div>
            <div className="h-6 w-16 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TraceDetailSkeleton() {
  return (
    <div className="border rounded-lg p-6 space-y-6 animate-pulse">
      <div className="space-y-3">
        <div className="h-5 w-1/4 bg-muted rounded" />
        <div className="h-4 w-1/3 bg-muted rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ paddingLeft: `${i * 16}px` }}>
            <div className="h-10 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-2">
            <div className="h-4 w-24 bg-muted rounded" />
            <div className="h-7 w-20 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-6 space-y-4">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-64 bg-muted rounded" />
          </div>
        ))}
      </div>

      {/* Activity Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3">
            <div className="h-5 w-24 bg-muted rounded" />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="h-12 bg-muted rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceMapSkeleton() {
  return (
    <div className="w-full h-full flex flex-col bg-white">
      {/* Top bar skeleton */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <div className="h-6 w-24 bg-muted rounded" />
        <div className="h-8 w-32 bg-muted rounded" />
        <div className="ml-auto h-8 w-8 bg-muted rounded" />
      </div>

      {/* Main skeleton area */}
      <div className="flex-1" />
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("border rounded-lg p-6 space-y-4 animate-pulse", className)}>
      <div className="h-5 w-32 bg-muted rounded" />
      <div className="h-64 bg-muted rounded" />
    </div>
  );
}
