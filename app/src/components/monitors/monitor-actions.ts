import type { QueryClient } from "@tanstack/react-query";
import { DASHBOARD_QUERY_KEY } from "@/hooks/use-dashboard";
import { MONITORS_QUERY_KEY, MONITOR_QUERY_KEY } from "@/hooks/use-monitors";
import { MONITOR_RESULTS_KEY, MONITOR_STATS_KEY } from "@/hooks/use-monitor-details";
import { hasPermission } from "@/lib/rbac/client-permissions";
import type { Role } from "@/lib/rbac/permissions-client";

/** Pause/resume goes through the monitor update endpoint, so it needs the same permission as editing. */
export function canToggleMonitors(role: Role | null | undefined): boolean {
  return role ? hasPermission(role, "monitor", "update") : false;
}

/** Status a paused monitor returns to: its last known result, or pending until the next check. */
export function getResumeStatus(lastResultIsUp?: boolean | null): "up" | "down" | "pending" {
  if (lastResultIsUp === undefined || lastResultIsUp === null) return "pending";
  return lastResultIsUp ? "up" : "down";
}

/** Refresh every cache a monitor write can change: list, single monitor, stats, results, dashboard. */
export function invalidateMonitorCaches(queryClient: QueryClient, monitorId?: string | null) {
  const opts = { refetchType: "all" as const };
  void queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY, ...opts });
  void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY, ...opts });
  if (!monitorId) return;
  void queryClient.invalidateQueries({ queryKey: [...MONITOR_QUERY_KEY, monitorId], ...opts });
  void queryClient.invalidateQueries({ queryKey: [...MONITOR_STATS_KEY, monitorId], ...opts });
  void queryClient.invalidateQueries({ queryKey: [...MONITOR_RESULTS_KEY, monitorId], ...opts });
}

export interface IntervalOption {
  value: string;
  label: string;
}

const intervalLabel = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;

/** Add the stored interval as an extra "(current)" option when it is not a preset, so editing never changes it silently. */
export function withCurrentInterval(options: IntervalOption[], current?: string | null): IntervalOption[] {
  if (!current || options.some((o) => o.value === current)) return options;
  const minutes = Math.round(parseInt(current, 10) / 60);
  if (!Number.isFinite(minutes) || minutes < 1) return options;
  return [{ value: current, label: `Every ${intervalLabel(minutes)} (current)` }, ...options];
}

// Optional keys the form owns per type: if the form leaves one out, it was cleared and must not survive the merge.
const CLEARABLE: Record<string, string[]> = {
  http_request: ["headers", "body", "auth", "keywordInBody", "keywordInBodyShouldBePresent"],
  website: ["headers", "auth", "keywordInBody", "keywordInBodyShouldBePresent", "sslDaysUntilExpirationWarning"],
};
// Defaults the form hardcodes but does not expose; on edit the stored value wins.
const UNMANAGED = ["timeoutSeconds", "playwrightOptions"];
// Legacy keys the PUT validator now rejects (see UNEVALUATED_CONFIG_KEYS in monitor-validation.ts); drop them so old monitors stay saveable.
const REJECTED_LEGACY = ["responseBodyJsonPath", "checkExpiration", "daysUntilExpirationWarning", "checkRevocation", "sslCheckOnStatusChange"];

/** Edit mode: start from the stored config and overlay only what the form manages. */
export function mergeEditConfig(
  type: string,
  stored: Record<string, unknown> | null | undefined,
  built: Record<string, unknown>
): Record<string, unknown> {
  if (!stored) return built;
  const managed = { ...built };
  for (const key of UNMANAGED) delete managed[key];
  if (type === "website") delete managed.method; // the form forces GET here; keep the stored method
  const merged = { ...stored, ...managed };
  for (const key of CLEARABLE[type] ?? []) if (!(key in built)) delete merged[key];
  for (const key of REJECTED_LEGACY) delete merged[key];
  const t = merged.timeoutSeconds; // validator accepts a finite number in 1..3600
  if (t !== undefined && (typeof t !== "number" || !Number.isFinite(t) || t < 1 || t > 3600)) {
    merged.timeoutSeconds = typeof t === "number" && Number.isFinite(t) ? Math.min(3600, Math.max(1, t)) : 30;
  }
  return merged;
}

/** Floor to 2 decimals so 99.996 never displays as 100%; "100%" only when exactly 100. */
export function formatUptime(value: number): string {
  return `${(Math.floor(value * 100 + 1e-9) / 100).toFixed(2)}%`;
}
