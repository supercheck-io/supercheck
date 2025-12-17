"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { Monitor } from "./schema";
import { Monitor as HookMonitor } from "@/hooks/use-monitors";
import { Row } from "@tanstack/react-table";
import { useMonitors } from "@/hooks/use-monitors";

export default function MonitorsList() {
  const router = useRouter();
  const [tableKey, setTableKey] = useState(0);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Use React Query hook for monitors data (cached, handles loading/error)
  // No pagination params = API returns all monitors for client-side filtering
  const { monitors, isLoading, invalidate } = useMonitors();
  

  // Handle row click to navigate to monitor detail
  const handleRowClick = useCallback((row: Row<Monitor>) => {
    router.push(`/monitors/${row.original.id}`);
  }, [router]);
  
  // Handle delete callback
  const handleDeleteMonitor = useCallback(async () => {
    // Check if mounted before proceeding
    if (!isMounted) return;
    
    // Invalidate React Query cache to refresh monitors list
    invalidate();
    setTableKey(prev => prev + 1);
  }, [isMounted, invalidate]);

  // Don't render until mounted
  if (!isMounted) {
    return (
      <div className="flex h-full flex-col space-y-4 p-2 mt-6">
        <DataTableSkeleton columns={5} rows={3} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4 p-2 mt-6">
      <DataTable
        key={tableKey}
        columns={columns}
        data={monitors as unknown as Monitor[]}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{
          onDeleteMonitor: handleDeleteMonitor,
        }}
      />
      
      {/* Pagination is handled by DataTable's client-side pagination */}
    </div>
  );
} 