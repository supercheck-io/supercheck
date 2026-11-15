"use client";

import { useQuery } from "@tanstack/react-query";

import { useProjectContext } from "@/hooks/use-project-context";

export const MAINTENANCE_QUERY_KEY = ["maintenance-windows"] as const;

export type MaintenanceWindowItem = {
  id: string;
  title: string;
  description: string | null;
  state: "scheduled" | "active" | "completed" | "cancelled";
  scope: "project" | "services" | "monitors";
  recurrence: "once" | "daily" | "weekly" | "monthly";
  timezone: string;
  occurrenceStartsAt: string | null;
  occurrenceEndsAt: string | null;
  targets: Array<{ type: "service" | "monitor"; id: string }>;
  statusPageIncidentIds: string[];
};

/** Maintenance windows of the current project, optionally only those covering one monitor. */
export function useMaintenanceWindows(filters: { monitorId?: string; state?: "active" | "scheduled" | "past" } = {}, enabled = true) {
  const { projectId } = useProjectContext();
  const params = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return useQuery({
    queryKey: [...MAINTENANCE_QUERY_KEY, projectId, params.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/maintenance-windows${params.size ? `?${params}` : ""}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as { windows: MaintenanceWindowItem[] }).windows;
    },
    enabled: enabled && Boolean(projectId),
    staleTime: 30_000,
    // Window state changes with the clock; refresh about once a minute while shown.
    refetchInterval: 60_000,
  });
}

export async function windowAction(id: string, action: "end" | "extend" | "cancel" | "delete", body?: unknown) {
  const response = await fetch(action === "delete" ? `/api/maintenance-windows/${id}` : `/api/maintenance-windows/${id}/${action}`, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: action === "delete" ? undefined : JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Action failed");
}
