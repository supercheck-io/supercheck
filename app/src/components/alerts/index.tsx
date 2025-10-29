"use client";

import React, { useState, useEffect, useCallback } from "react";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { AlertHistory } from "./schema";
import { useProjectContext } from "@/hooks/use-project-context";

export function AlertsComponent() {
  const [alerts, setAlerts] = useState<AlertHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const { projectId } = useProjectContext();

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetAlerts = useCallback((alerts: AlertHistory[] | ((prev: AlertHistory[]) => AlertHistory[])) => {
    if (mounted) {
      setAlerts(alerts);
    }
  }, [mounted]);

  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (mounted) {
      setIsLoading(loading);
    }
  }, [mounted]);

  const fetchAlerts = useCallback(async () => {
    safeSetIsLoading(true);
    try {
      // Only fetch alerts if we have a projectId
      if (!projectId) {
        safeSetAlerts([]);
        safeSetIsLoading(false);
        return;
      }

      const response = await fetch(`/api/alerts/history?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        safeSetAlerts(data);
      } else {
        console.error('Failed to fetch alerts');
        safeSetAlerts([]);
      }
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
      safeSetAlerts([]);
    } finally {
      safeSetIsLoading(false);
    }
  }, [safeSetAlerts, safeSetIsLoading, projectId]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="h-full flex-1 flex-col p-2 mt-6">
        <DataTableSkeleton columns={4} rows={3} />
      </div>
    );
  }

  return (
    <div className="h-full flex-1 flex-col p-2 mt-6">
      <DataTable 
        columns={columns} 
        data={alerts} 
        isLoading={isLoading}
      />
    </div>
  );
}
