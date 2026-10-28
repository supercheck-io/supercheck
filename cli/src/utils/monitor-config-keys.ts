/** Legacy monitor config keys no check evaluates; the server rejects them on write, so pull and diff both ignore them. */
export const UNEVALUATED_MONITOR_CONFIG_KEYS = ['responseBodyJsonPath', 'checkExpiration', 'daysUntilExpirationWarning', 'checkRevocation', 'sslCheckOnStatusChange'] as const
