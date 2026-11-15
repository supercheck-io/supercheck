const credentialKey = /^(?:xauth|xsignature|xsig|signature|authorization|proxyauthorization|cookie|setcookie|webhookUrl|discordWebhookUrl|teamsWebhookUrl|encryptedValue|auth|webhook|pass|pwd|cookies|sessionid|jwt|routingkey|devicecode)$|(?:token|secret|pass(?:w(?:or)?d)?|apikey|appkey|accesskey|privatekey|credentials?)$/i
// Monitor configs hold a public target URL and request headers the operator must be able to review. Any other `config`
// (notification providers, untyped API error bodies) is treated as credential-bearing, so the default fails closed.
const monitorTypes = new Set(['http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat', 'mcp_server'])
let reveal = false
export function canRevealSecrets(): boolean { return reveal }
export function setRevealSecrets(value: boolean): void { reveal = value }
// Heartbeat ping tokens (hb_ + 32 hex) are masked everywhere except a `pingUrl` field the server returned on purpose.
const cliTokens = (text: string) => text.replace(/(?:sck_(?:live|test|trigger)_|job_)[a-zA-Z0-9]{12,}/g, '[REDACTED]').replace(/\bhb_[0-9a-f]{32}\b/gi, 'hb_[REDACTED]')
function maskUrl(raw: string): string {
  try {
    const url = new URL(raw)
    let changed = false
    if (url.username || url.password) { url.username = 'REDACTED'; url.password = ''; changed = true }
    for (const key of [...url.searchParams.keys()]) if (/token|secret|passw|key|sig|credential|auth|code|hash|session/i.test(key)) { url.searchParams.set(key, 'REDACTED'); changed = true }
    return changed ? url.toString() : raw
  } catch { return raw }
}
/** Free text (messages, captured output): mask CLI tokens and credentials in any embedded URL. */
export function redactText(text: string): string {
  if (reveal) return text
  return maskUserinfo(cliTokens(text)).replace(/https?:\/\/[^\s"'<>]+/gi, maskUrl)
}
// Credentials embedded as scheme://user:pass@host are masked in every string, including script bodies.
const maskUserinfo = (text: string): string => text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]*@/gi, '$1REDACTED@')
// Query-parameter masking rewrites URLs, so it is skipped for fields that carry source code.
const codeKeys = new Set(['script', 'body', 'code', 'content', 'source'])
export function redact<T>(value: T, inConfig = false, code = false): T {
  if (reveal) return value
  if (typeof value === 'string') return (code ? maskUserinfo(cliTokens(value)) : redactText(maskUserinfo(value))) as T
  if (Array.isArray(value)) return value.map((item) => redact(item, false, code)) as T
  if (!value || typeof value !== 'object' || value instanceof Date) return value
  const record = value as Record<string, unknown>
  const sensitiveConfig = !(typeof record.type === 'string' && monitorTypes.has(record.type))
  // Monitor auth that only names a project secret (plus a basic-auth username or an MCP header name), or is `none`,
  // carries no credential, so it round-trips through pull.
  const secretRefAuth = (key: string, item: unknown) => key === 'auth' && !!item && typeof item === 'object'
    && Object.keys(item).every((k) => k === 'type' || k === 'secretKey' || k === 'username' || k === 'headerName')
    && (typeof (item as Record<string, unknown>).secretKey === 'string' || (Object.keys(item).length === 1 && (item as Record<string, unknown>).type === 'none'))
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key,
    key === 'pingUrl' && typeof item === 'string' ? item : secretRefAuth(key, item) ? redact(item, false) : (credentialKey.test(key.replace(/[-_]/g, '')) || (inConfig && ['url', 'headers', 'username'].includes(key)) || (key === 'value' && (record.isSecret || record.type === 'secret'))) && item != null && typeof item !== 'boolean'
      ? (typeof item === 'string' && ['[local secret provided]', '[remote secret masked]'].includes(item) ? item : '[REDACTED]') : redact(item, key === 'config' && sensitiveConfig, codeKeys.has(key.toLowerCase())),
  ])) as T
}
