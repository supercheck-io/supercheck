import type { MonitorType } from "@/db/schema/types";

/**
 * Warning-only alerts (alert type `monitor_warning`). A warning notifies the monitor's non-preset
 * channels and never opens an incident. New kinds are a row here plus a worker `sendWarning` call;
 * keep worker/src/monitor/warning-kinds.ts in sync (warning-kinds-parity.spec.ts enforces it).
 */
export const WARNING_KINDS = {
  heartbeat_late: {
    monitorTypes: ["heartbeat"],
    label: "Ping is late",
    help: "Notify when a ping has not arrived on time but the grace period has not ended.",
    defaultOn: false,
  },
} as const satisfies Record<
  string,
  { monitorTypes: readonly MonitorType[]; label: string; help: string; defaultOn: boolean }
>;

export type WarningKind = keyof typeof WARNING_KINDS;

export function isWarningKind(kind: string): kind is WarningKind {
  return Object.prototype.hasOwnProperty.call(WARNING_KINDS, kind);
}

export function warningKindsForMonitorType(type: string): WarningKind[] {
  return (Object.keys(WARNING_KINDS) as WarningKind[]).filter((kind) =>
    (WARNING_KINDS[kind].monitorTypes as readonly string[]).includes(type),
  );
}

/** Keep only boolean toggles for kinds valid for this monitor type; undefined when none remain. */
export function normalizeWarningToggles(
  type: string,
  warnings: unknown,
): Record<string, boolean> | undefined {
  if (!warnings || typeof warnings !== "object" || Array.isArray(warnings)) return undefined;
  const allowed = new Set<string>(warningKindsForMonitorType(type));
  const out: Record<string, boolean> = {};
  for (const [kind, value] of Object.entries(warnings as Record<string, unknown>)) {
    if (allowed.has(kind) && typeof value === "boolean") out[kind] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** True when at least one warning valid for this monitor type is switched on (it counts as an alert type). */
export function hasWarningOn(type: string, warnings: unknown): boolean {
  return Object.values(normalizeWarningToggles(type, warnings) ?? {}).includes(true);
}

/** `ssl_renewed` and `monitor_warning` notify only: no incident triage, no incident open/resolve. */
export function isInformationalAlertType(type: string): boolean {
  return type === "ssl_renewed" || type === "monitor_warning";
}
