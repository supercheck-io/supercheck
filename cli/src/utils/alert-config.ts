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
