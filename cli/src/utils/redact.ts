const credentialKey = /^(?:password|passwd|token|secret|apiKey|appKey|accessKey|privateKey|clientSecret|authorization|proxyauthorization|cookie|setcookie|webhookUrl|discordWebhookUrl|teamsWebhookUrl|botToken|encryptedValue|username|auth|accesstoken|xauthtoken|xapikey|xaccesstoken|webhook)$/i
let reveal = false
export function setRevealSecrets(value: boolean): void { reveal = value }
export function redactText(text: string): string {
  if (reveal) return text
  return text.replace(/(?:sck_(?:live|test|trigger)_|job_)[a-zA-Z0-9]{12,}/g, '[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try {
        const url = new URL(raw)
        let changed = false
        if (url.username || url.password) { url.username = 'REDACTED'; url.password = ''; changed = true }
        for (const key of [...url.searchParams.keys()]) if (/token|secret|passw|api.?key|signature|credential|auth/i.test(key)) { url.searchParams.set(key, 'REDACTED'); changed = true }
        return changed ? url.toString() : raw
      } catch { return raw }
    })
}
export function redact<T>(value: T, inConfig = false): T {
  if (reveal) return value
  if (typeof value === 'string') return redactText(value) as T
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key,
    (credentialKey.test(key.replace(/[-_]/g, '')) || (inConfig && ['url', 'headers'].includes(key)) || (key === 'value' && (record.isSecret || record.type === 'secret'))) && item != null && typeof item !== 'boolean'
      ? (typeof item === 'string' && ['[local secret provided]', '[remote secret masked]'].includes(item) ? item : '[REDACTED]') : redact(item, key === 'config'),
  ])) as T
}
