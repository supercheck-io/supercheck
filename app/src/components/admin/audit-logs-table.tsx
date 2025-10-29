"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { AdminDataTable } from "./admin-data-table";
import { AuditTableToolbar } from "./audit-table-toolbar";
import { auditLogColumns, type AuditLog } from "./audit-columns";
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

export function AuditLogsTable({ className }: AuditLogsTableProps) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  const fetchAuditLogs = React.useCallback(async () => {
    if (!mounted) return;
    
    setLoading(true);
    try {
      // Fetch a large number of records to use client-side pagination
      const params = new URLSearchParams({
        page: '1',
        limit: '1000', // Large limit to get most/all records
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      const response = await fetch(`/api/audit?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Audit API failed:', response.status, response.statusText, errorText);
        toast.error(`Failed to load audit logs: ${response.status} ${response.statusText}`);
        return;
      }

      const result = await response.json();

      if (result.success) {
        setData({
          logs: result.data.logs,
          filters: result.data.filters
        });
      } else {
        console.error('Audit API error:', result.error);
        toast.error(result.error || 'Failed to load audit logs');
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast.error('Failed to load audit logs');
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
    data.logs.forEach(log => {
      const userName = log.user.name || 'System';
      if (!uniqueUsers.has(userName)) {
        uniqueUsers.set(userName, {
          name: log.user.name,
          email: log.user.email
        });
      }
    });
    return Array.from(uniqueUsers.values());
  }, [data?.logs]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomToolbar = React.useCallback(({ table }: { table: any }) => {
    return (
      <AuditTableToolbar 
        table={table} 
        availableUsers={availableUsers}
      />
    );
  }, [availableUsers]);

  if (!mounted || loading) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <AdminDataTable
        columns={auditLogColumns}
        data={data?.logs || []}
        toolbar={CustomToolbar}
        title="Audit Logs"
        description="Track all administrative actions and system events in your organization."
        itemName="logs"
        meta={{
          globalFilterColumns: ["action", "user", "details"],
        }}
      />
    </div>
  );
}