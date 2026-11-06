"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { AdminDataTable } from "./admin-data-table";
import { AuditTableToolbar } from "./audit-table-toolbar";
import { auditLogColumns, type AuditLog } from "./audit-columns";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface AuditData {
  logs: AuditLog[];
  filters: {
    actions: string[];
  };
  organizationId: string | null;
  totalCount: number;
  nextCursor: string | null;
}

interface AuditLogsTableProps {
  className?: string;
}

const PAGE_SIZE = 100; // the API clamps limit to 100

type AuditPage = {
  logs: AuditLog[];
  filters: AuditData["filters"];
  organizationId?: string;
  pagination: { totalCount: number; nextCursor: string | null };
};

async function getAuditPage(cursor: string | null, signal: AbortSignal): Promise<AuditPage | null> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), sortOrder: "desc" });
  if (cursor) params.set("cursor", cursor);
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
  return result.data as AuditPage;
}

export function AuditLogsTable({ className }: AuditLogsTableProps) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
    try {
      const first = await getAuditPage(null, controller.signal);
      if (!first) return;
      setData({
        logs: first.logs,
        filters: first.filters,
        organizationId: first.organizationId ?? null,
        totalCount: first.pagination.totalCount,
        nextCursor: first.pagination.nextCursor,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Error fetching audit logs:", error);
      toast.error("Failed to load audit logs");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [mounted]);

  // Only fetch on mount
  useEffect(() => {
    if (mounted) {
      fetchAuditLogs();
    }
  }, [mounted, fetchAuditLogs]);

  // Keyset paging: each request continues from the last row shown, so rows are never skipped or
  // repeated when new events arrive, and nothing is dropped beyond a fixed cap.
  const loadMore = async () => {
    if (!data?.nextCursor || loadingMore) return;
    const controller = abortRef.current ?? new AbortController();
    setLoadingMore(true);
    try {
      const next = await getAuditPage(data.nextCursor, controller.signal);
      if (!next || controller.signal.aborted) return;
      if ((next.organizationId ?? null) !== data.organizationId) {
        // The active organization changed in another tab: mixing orgs would mislead.
        toast.error("Organization changed. Reloading audit logs.");
        setData(null);
        void fetchAuditLogs();
        return;
      }
      setData((current) => {
        if (!current) return current;
        const seen = new Set(current.logs.map((log) => log.id));
        return {
          ...current,
          logs: [...current.logs, ...next.logs.filter((log) => !seen.has(log.id))],
          totalCount: next.pagination.totalCount,
          nextCursor: next.pagination.nextCursor,
        };
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Error fetching audit logs:", error);
      toast.error("Failed to load more audit logs");
    } finally {
      setLoadingMore(false);
    }
  };

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

  if (!data) {
    return (
      <div className={`flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground ${className ?? ""}`}>
        <p>Audit logs are unavailable.</p>
        <Button variant="outline" size="sm" onClick={() => void fetchAuditLogs()}>
          Retry
        </Button>
      </div>
    );
  }

  const loaded = data.logs.length;

  return (
    <div className={`space-y-4 ${className}`}>
      <AdminDataTable
        columns={auditLogColumns}
        data={data.logs}
        toolbar={CustomToolbar}
        itemName="audit logs"
        keepPageOnDataChange
        meta={{
          globalFilterColumns: ["action", "user", "details"],
        }}
      />
      {data.nextCursor && (
        <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <span aria-live="polite">
            Showing the newest {loaded.toLocaleString()} of {data.totalCount.toLocaleString()} events. Search and
            filters apply to these.
          </span>
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load older events
          </Button>
        </div>
      )}
    </div>
  );
}
