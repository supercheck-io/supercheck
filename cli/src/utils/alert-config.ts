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
 * A local alertConfig as the server stores it (defaults filled), then stripped like the remote copy, for diffing only.
 * The deploy payload keeps the user's original values so an explicit `false` is still sent.
 */
export function normalizeLocalAlertConfig(alert: Record<string, unknown>): Record<string, unknown> | undefined {
  return normalizeAlertConfig({ ...alert, enabled: Boolean(alert.enabled), alertOnFailure: alert.alertOnFailure ?? true })
}
