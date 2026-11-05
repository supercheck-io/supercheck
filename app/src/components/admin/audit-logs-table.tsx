"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { AdminDataTable } from "./admin-data-table";
import { AuditTableToolbar } from "./audit-table-toolbar";
import { auditLogColumns, type AuditLog } from "./audit-columns";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { toast } from "sonner";

interface AuditData {
  logs: AuditLog[];
  filters: {
    actions: string[];
  };
}

interface AuditLogsTableProps {
  className?: string;
}

const PAGE_SIZE = 100; // the API clamps limit to 100
const MAX_PAGES = 20;

export function AuditLogsTable({ className }: AuditLogsTableProps) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
      abortRef.current?.abort();
    };
  }, []);

  const fetchAuditLogs = React.useCallback(async () => {
    if (!mounted) return;

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    try {
      // The API caps a page at 100 rows, so read the pages in turn; the table then pages and filters
      // client-side. shortcut: capped at MAX_PAGES (2,000 newest rows), move to server paging beyond that.
      const getPage = async (page: number) => {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        const response = await fetch(`/api/audit?${params}`, { signal });
        if (!response.ok) {
          console.error("Audit API failed:", response.status, response.statusText);
          toast.error(`Failed to load audit logs: ${response.status} ${response.statusText}`);
          return null;
        }
        const result = await response.json();
        if (!result.success) {
          console.error("Audit API error:", result.error);
          toast.error(result.error || "Failed to load audit logs");
          return null;
        }
        return result.data as {
          logs: AuditLog[];
          filters: AuditData["filters"];
          pagination: { totalPages: number };
        };
      };

      const first = await getPage(1);
      if (!first) return;
      const lastPage = Math.min(first.pagination.totalPages, MAX_PAGES);
      // Show the newest page at once, then add older pages one request at a time; a failed page keeps what loaded.
      let logs = first.logs;
      const seen = new Set(logs.map((log) => log.id));
      setData({ logs, filters: first.filters });
      setLoading(false);
      for (let page = 2; page <= lastPage && !signal.aborted; page++) {
        const next = await getPage(page);
        if (!next) break;
        // Offset pages shift when new events arrive mid-load; drop rows already shown.
        logs = [...logs, ...next.logs.filter((log) => !seen.has(log.id) && seen.add(log.id))];
        setData({ logs, filters: first.filters });
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error("Error fetching audit logs:", error);
      toast.error("Failed to load audit logs");
    } finally {
      if (mounted) {
        setLoading(false);
      }
    }
  }, [mounted]);

  // Only fetch on mount
  useEffect(() => {
    if (mounted) {
      fetchAuditLogs();
    }
  }, [mounted, fetchAuditLogs]);

  // Extract unique users from logs for filtering
  const availableUsers = React.useMemo(() => {
    if (!data?.logs) return [];
    const uniqueUsers = new Map();
    data.logs.forEach((log) => {
      const userName = log.user.name || "System";
      if (!uniqueUsers.has(userName)) {
        uniqueUsers.set(userName, {
          name: log.user.name,
          email: log.user.email,
        });
      }
    });
    return Array.from(uniqueUsers.values());
  }, [data?.logs]);

  const CustomToolbar = React.useCallback(
     
    ({ table }: { table: any }) => {
      return (
        <AuditTableToolbar table={table} availableUsers={availableUsers} />
      );
    },
    [availableUsers]
  );

  if (!mounted || loading) {
    return <TabLoadingSpinner message="Loading audit logs..." />;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <AdminDataTable
        columns={auditLogColumns}
        data={data?.logs || []}
        toolbar={CustomToolbar}
        itemName="audit logs"
        meta={{
          globalFilterColumns: ["action", "user", "details"],
        }}
      />
    </div>
  );
}
