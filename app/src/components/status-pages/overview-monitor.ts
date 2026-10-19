import type { Monitor } from "@/components/monitors/schema";
import type { StatusPageMonitor } from "@/hooks/use-status-pages";

export function toOverviewMonitor(monitor: StatusPageMonitor, componentName: string): Monitor & { componentName: string } {
  return {
    ...monitor,
    status: monitor.status || "pending",
    target: monitor.target || "",
    frequencyMinutes: monitor.frequencyMinutes ?? 5,
    enabled: monitor.enabled,
    createdAt: monitor.createdAt ? new Date(monitor.createdAt).toISOString() : undefined,
    updatedAt: monitor.updatedAt ? new Date(monitor.updatedAt).toISOString() : undefined,
    componentName,
  } as Monitor & { componentName: string };
}
