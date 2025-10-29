"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { Monitor } from "./schema";
import { Row } from "@tanstack/react-table";
import { useProjectContext } from "@/hooks/use-project-context";

export default function MonitorsList() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tableKey, setTableKey] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [paginationMeta, setPaginationMeta] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } | null>(null);
  const { projectId, currentProject } = useProjectContext();
  const monitorsPerPage = 20;
  
  // Set mounted state
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);
  
  // Fetch monitors with pagination and proper cleanup
  const fetchMonitors = useCallback(async (page: number = 1) => {
    if (!isMounted) return;
    
    setIsLoading(true);
    const abortController = new AbortController();
    
    try {
      // Only fetch monitors if we have a projectId and organizationId
      if (!projectId || !currentProject?.organizationId) {
        setMonitors([]);
        setPaginationMeta(null);
        setIsLoading(false);
        return;
      }

      const params = new URLSearchParams({
        projectId,
        organizationId: currentProject.organizationId,
        page: page.toString(),
        limit: monitorsPerPage.toString(),
      });

      const response = await fetch(`/api/monitors?${params}`, {
        signal: abortController.signal
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch monitors');
      }
      
      const result = await response.json();
      
      // Only update state if component is still mounted and request wasn't aborted
      if (isMounted && !abortController.signal.aborted) {
        // Check if result has pagination metadata (new API format)
        if (result.data && result.pagination) {
          setMonitors(result.data);
          setPaginationMeta(result.pagination);
        } else {
          // Backward compatibility with non-paginated response
          setMonitors(result);
          setPaginationMeta(null);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return; // Request was aborted, don't update state
      }
      
      console.error('Error fetching monitors:', error);
      
      // Use empty array as fallback, but only if still mounted
      if (isMounted && !abortController.signal.aborted) {
        setMonitors([]);
        setPaginationMeta(null);
      }
    } finally {
      // Only update loading state if still mounted and not aborted
      if (isMounted && !abortController.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [isMounted, projectId, currentProject?.organizationId, monitorsPerPage]);

  // Initial fetch and when dependencies change
  useEffect(() => {
    if (isMounted) {
      setCurrentPage(1); // Reset to first page when project changes
      fetchMonitors(1);
    }
  }, [isMounted, projectId, currentProject?.organizationId, fetchMonitors]);

  // Fetch when page changes
  useEffect(() => {
    if (isMounted && currentPage > 1) {
      fetchMonitors(currentPage);
    }
  }, [currentPage, fetchMonitors, isMounted]);

  // Handle row click to navigate to monitor detail
  const handleRowClick = useCallback((row: Row<Monitor>) => {
    router.push(`/monitors/${row.original.id}`);
  }, [router]);
  
  // Handle delete callback
  const handleDeleteMonitor = useCallback(async () => {
    // Check if mounted before proceeding
    if (!isMounted) return;
    
    try {
      // Refresh current page after deletion
      await fetchMonitors(currentPage);
      setTableKey(prev => prev + 1);
    } catch (error) {
      console.error('Error refreshing monitors:', error);
    }
  }, [isMounted, fetchMonitors, currentPage]);

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
        data={monitors}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{
          onDeleteMonitor: handleDeleteMonitor,
        }}
      />
      
      {/* Pagination Controls */}
      {!isLoading && paginationMeta && paginationMeta.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card rounded-b-lg">
          <div className="text-sm text-muted-foreground">
            Showing {monitors.length} of {paginationMeta.total} monitors
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={!paginationMeta.hasPrevPage}
              className="px-3 py-1 text-sm border border-border rounded-md bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {paginationMeta.page} of {paginationMeta.totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(paginationMeta.totalPages, prev + 1))}
              disabled={!paginationMeta.hasNextPage}
              className="px-3 py-1 text-sm border border-border rounded-md bg-background hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 