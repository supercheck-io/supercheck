"use client";

import { BellRing } from "lucide-react";
import { DataTable } from "@/components/alerts/data-table";
import { columns } from "@/components/alerts/columns";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import type { AlertHistory } from "@/components/alerts/schema";

/** Notification delivery history table (one row per delivery attempt). */
export function AlertHistoryPanel({
  alertHistory,
  isLoading,
}: {
  alertHistory: AlertHistory[];
  isLoading: boolean;
}) {
  return (
    <div className="h-full flex-1 flex-col md:flex">
      {alertHistory.length === 0 && !isLoading ? (
        <DashboardEmptyState
          className="min-h-[360px]"
          title="No alerts found"
          description="Alerts will appear here when your monitors or jobs trigger notifications"
          icon={<BellRing className="h-12 w-12" />}
        />
      ) : (
        <DataTable columns={columns} data={alertHistory} isLoading={isLoading} />
      )}
    </div>
  );
}
