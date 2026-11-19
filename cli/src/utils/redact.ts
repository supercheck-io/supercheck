const credentialKey = /^(?:xauth|xsignature|xsig|signature|authorization|proxyauthorization|cookie|setcookie|webhookUrl|discordWebhookUrl|teamsWebhookUrl|encryptedValue|auth|webhook|pass|pwd|cookies|sessionid|jwt|routingkey|devicecode)$|(?:token|secret|pass(?:w(?:or)?d)?|apikey|appkey|accesskey|privatekey|credentials?)$/i
// Monitor configs hold a public target URL and request headers the operator must be able to review. Any other `config`
// (notification providers, untyped API error bodies) is treated as credential-bearing, so the default fails closed.
const monitorTypes = new Set(['http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat', 'mcp_server'])
let reveal = false
export function canRevealSecrets(): boolean { return reveal }
export function setRevealSecrets(value: boolean): void { reveal = value }
/** Written straight to stderr (log levels silence warnings under --json/--quiet) instead of putting a new heartbeat's ping URL into --json/--quiet output, which often ends up in CI logs. */
export const PING_URL_HIDDEN = (id: string) => `Ping URL not included in machine output. Show it with: supercheck monitor heartbeat-url ${id}`
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
// A webhook body template carries literal credentials (the PagerDuty routing_key); `{{placeholders}}` stay readable.
// A field is a credential when any word of its name is key, token, secret, password or signature (routing_key, apiKey, token_value), so "monkey" is not.
const CREDENTIAL_WORDS = new Set(['key', 'token', 'secret', 'password', 'signature'])
// Run-together compounds (apikey, routingkey) have no word break to split on.
const CREDENTIAL_COMPOUNDS = /(?:apikey|accesskey|appkey|authkey|routingkey|secretkey|privatekey|accesstoken|authtoken|authorization)$/
const isCredentialField = (name: string): boolean =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_-]/).some((word) => CREDENTIAL_WORDS.has(word)) ||
  CREDENTIAL_COMPOUNDS.test(name.replace(/[_-]/g, '').toLowerCase())
const TEMPLATE_STRING_FIELD = /("([^"\\]+)"\s*:\s*")((?:[^"{}\\]|\\.)+)"/g
const maskTemplateSecrets = (text: string): string =>
  text.replace(TEMPLATE_STRING_FIELD, (whole, prefix: string, name: string) => (isCredentialField(name) ? `${prefix}[REDACTED]"` : whole))
/** True when a webhook body template holds a literal credential (not a `{{placeholder}}` or the preset stand-in). */
export const templateHoldsCredential = (text: string): boolean =>
  [...text.matchAll(TEMPLATE_STRING_FIELD)].some((m) => isCredentialField(m[2]) && !m[3].startsWith('REPLACE_WITH_'))
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
    key === 'pingUrl' && typeof item === 'string' ? item : inConfig && key === 'bodyTemplate' && typeof item === 'string' ? redactText(maskTemplateSecrets(item)) : secretRefAuth(key, item) ? redact(item, false) : (credentialKey.test(key.replace(/[-_]/g, '')) || (inConfig && ['url', 'headers', 'username'].includes(key)) || (key === 'value' && (record.isSecret || record.type === 'secret'))) && item != null && typeof item !== 'boolean'
      ? (typeof item === 'string' && ['[local secret provided]', '[remote secret masked]'].includes(item) ? item : '[REDACTED]') : redact(item, key === 'config' && sensitiveConfig, codeKeys.has(key.toLowerCase())),
  ])) as T
}
