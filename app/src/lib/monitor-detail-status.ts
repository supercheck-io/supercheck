import type { MonitorStatus } from "@/db/schema/types";

type MonitorDetailResult = {
  location?: string | null;
  isUp: boolean;
};

/**
 * Resolve the monitor status shown in the detail header.
 *
 * For the aggregate "all locations" view, the backend monitor status is the
 * source of truth because it is already computed from the latest execution
 * cycle. Recomputing from the chart's bounded historical result window can
 * incorrectly resurrect stale offline-location rows.
 */
export function resolveMonitorDetailStatus(
  monitorStatus: MonitorStatus,
  recentResults: MonitorDetailResult[] | null | undefined,
  selectedLocation: "all" | string
): MonitorStatus {
  if (selectedLocation === "all" || !recentResults || recentResults.length === 0) {
    return monitorStatus;
  }

  const locationResult = recentResults.find(
    (result) => result.location === selectedLocation
  );
  if (!locationResult) {
    return monitorStatus;
  }

  return locationResult.isUp ? "up" : "down";
}
