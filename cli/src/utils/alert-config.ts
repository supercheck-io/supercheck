/** Warning kinds that are on when unset (app/src/lib/alerts/warning-kinds.ts `defaultOn`); every other kind is off. */
const WARNINGS_ON_BY_DEFAULT = new Set(['mcp_tools_changed', 'mcp_slow', 'ai_slow_first_token', 'ai_model_changed', 'ai_tokens_high', 'agent_run_failed'])

export function warningDefault(kind: string): boolean {
  return WARNINGS_ON_BY_DEFAULT.has(kind)
}

/**
 * Normalize an alertConfig object by removing server defaults.
 * Mirrors the stripping logic in pull.ts buildMonitorDefinitions/buildJobDefinitions.
 */
export function normalizeAlertConfig(alert: Record<string, unknown>): Record<string, unknown> | undefined {
  const normalized = { ...alert }

  // Remove empty/default values
  if (normalized.customMessage === '' || normalized.customMessage === null) delete normalized.customMessage
  if (normalized.failureThreshold === 1) delete normalized.failureThreshold
  if (normalized.recoveryThreshold === 1) delete normalized.recoveryThreshold

  // Remove false boolean flags (they're defaults)
  for (const key of ['alertOnFailure', 'alertOnRecovery', 'alertOnSslExpiration', 'alertOnSuccess', 'alertOnTimeout']) {
    if (normalized[key] === false) delete normalized[key]
  }

  // Remove empty notificationProviders array
  if (Array.isArray(normalized.notificationProviders) && (normalized.notificationProviders as string[]).length === 0) {
    delete normalized.notificationProviders
  }

  // An unset warning takes its kind's default, so only toggles that differ from it round-trip.
  if (normalized.warnings && typeof normalized.warnings === 'object') {
    const on = Object.entries(normalized.warnings as Record<string, unknown>).filter(([kind, value]) => typeof value === 'boolean' && value !== warningDefault(kind))
    if (on.length > 0) normalized.warnings = Object.fromEntries(on)
    else delete normalized.warnings
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * A local alertConfig as the server would store it after an update, then stripped like the remote copy, for diffing only.
 * Jobs keep a stored field the config omits; monitors reset omitted fields to the server defaults.
 * The deploy payload keeps the user's original values so an explicit `false` is still sent.
 */
export function normalizeLocalAlertConfig(alert: Record<string, unknown>, remote: unknown, resourceType?: string): Record<string, unknown> | undefined {
  if (resourceType === 'job' && remote && typeof remote === 'object') return normalizeAlertConfig({ ...(remote as Record<string, unknown>), ...alert })
  return normalizeAlertConfig({ ...alert, enabled: Boolean(alert.enabled), alertOnFailure: alert.alertOnFailure ?? true })
}
