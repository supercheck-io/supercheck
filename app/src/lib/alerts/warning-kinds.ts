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
  mcp_tools_changed: {
    monitorTypes: ["mcp_server"],
    label: "Tools changed",
    help: "Notify when the server's tool list, a tool description or an input schema changes.",
    defaultOn: true,
  },
  mcp_slow: {
    monitorTypes: ["mcp_server"],
    label: "MCP slow",
    help: "Notify when checks are slower than Slow after (ms) for 3 checks in a row. Sends nothing until that limit is set.",
    defaultOn: true,
  },
  ai_slow_first_token: {
    monitorTypes: ["http_request"],
    aiEndpointOnly: true,
    label: "Slow first token",
    help: "Notify when the first token is slower than the \"Warn when first token is slower than (ms)\" limit for 3 checks in a row. Sends nothing until that limit is set.",
    defaultOn: true,
  },
  ai_model_changed: {
    monitorTypes: ["http_request"],
    aiEndpointOnly: true,
    label: "Model changed",
    help: "Notify when the reply comes from a different model than the last check.",
    defaultOn: true,
  },
  ai_tokens_high: {
    monitorTypes: ["http_request"],
    aiEndpointOnly: true,
    label: "Tokens high",
    help: "Notify when a reply uses more tokens than the \"Warn when a call uses more tokens than\" limit. Sends nothing until that limit is set.",
    defaultOn: true,
  },
  agent_run_failed: {
    monitorTypes: ["synthetic_test"],
    agentTestOnly: true,
    label: "Single failed agent run",
    help: "An agent test run failed before the failure threshold. Notifies only; never opens an incident.",
    defaultOn: true,
  },
} as const satisfies Record<
  string,
  // aiEndpointOnly: listed only for HTTP monitors that use the AI endpoint preset; agentTestOnly: only for synthetic monitors on an agent test.
  { monitorTypes: readonly MonitorType[]; aiEndpointOnly?: true; agentTestOnly?: true; label: string; help: string; defaultOn: boolean }
>;

/** Default "Warn when first token is slower than" for an AI endpoint; the monitor form shows it as its example. */
export const AI_WARN_FIRST_TOKEN_DEFAULT_MS = 3000;

export type WarningKind = keyof typeof WARNING_KINDS;

export function isWarningKind(kind: string): kind is WarningKind {
  return Object.prototype.hasOwnProperty.call(WARNING_KINDS, kind);
}

/** Kinds offered for this monitor; `aiEndpoint` / `agentTest` add the AI endpoint preset's and agent test's kinds (a bare boolean means `aiEndpoint`). Normalization keeps all type kinds. */
export function warningKindsForMonitorType(
  type: string,
  options: boolean | { aiEndpoint?: boolean; agentTest?: boolean } = {},
): WarningKind[] {
  const { aiEndpoint, agentTest } = typeof options === "boolean" ? { aiEndpoint: options, agentTest: false } : options;
  return (Object.keys(WARNING_KINDS) as WarningKind[]).filter((kind) => {
    const def: { monitorTypes: readonly string[]; aiEndpointOnly?: true; agentTestOnly?: true } = WARNING_KINDS[kind];
    return def.monitorTypes.includes(type) && (aiEndpoint || !def.aiEndpointOnly) && (agentTest || !def.agentTestOnly);
  });
}

/** Keep only boolean toggles for kinds valid for this monitor type; undefined when none remain. */
export function normalizeWarningToggles(
  type: string,
  warnings: unknown,
): Record<string, boolean> | undefined {
  if (!warnings || typeof warnings !== "object" || Array.isArray(warnings)) return undefined;
  // Every kind of the type, preset-only ones included: an AI endpoint toggle must persist to be turned off.
  const allowed = new Set<string>(warningKindsForMonitorType(type, { aiEndpoint: true, agentTest: true }));
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
