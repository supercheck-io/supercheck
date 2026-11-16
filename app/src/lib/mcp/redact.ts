import { redactConnectorText } from "@/lib/sre/connectors/output-sanitizer";

const MAX_FIELD_CHARS = 4 * 1024;


/** Extra patterns the shared connector redactor does not cover. */
const EXTRA_PATTERNS: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi, "[REDACTED_URL_CREDENTIALS]@"],
  // Digest parameters are quoted strings that may hold escaped quotes, so the rest of the line is masked.
  [/\b(authorization|proxy-authorization)\s*[:=]\s*digest\s[^\r\n]*/gi, "$1: Digest [REDACTED]"],
  [/\b(authorization|proxy-authorization)\s*[:=]\s*(basic|bearer)\s+(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi, "$1: [REDACTED]"],
  // Chat webhook URLs carry their secret in the path (Discord, Microsoft Teams, Telegram bot token).
  [/\bhttps?:\/\/(?:[a-z0-9-]+\.)*discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[^\s"'<>]+/gi, "[REDACTED_WEBHOOK_URL]"],
  [/\bhttps?:\/\/[a-z0-9.-]+\.(?:webhook\.office\.com|logic\.azure\.com|powerplatform\.com)(?::\d+)?\/[^\s"'<>]+/gi, "[REDACTED_WEBHOOK_URL]"],
  [/\bbot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot[REDACTED]"],
  [/\bhttps?:\/\/hooks\.slack\.com\/(?:workflows|triggers)\/[^\s"'<>]+/gi, "[REDACTED_WEBHOOK_URL]"],
  [/\bhttps?:\/\/outlook\.office(?:365)?\.com\/webhook\/[^\s"'<>]+/gi, "[REDACTED_WEBHOOK_URL]"],
  [/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[REDACTED_KEY]"],
  // Supercheck's own credentials: CLI and recorder keys (sck_live_, sck_test_), trigger keys (sck_trigger_), and job keys.
  [/\bsck_(?:live|test|trigger)_[A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]"],
  [/\bjob_[a-f0-9]{24,}/gi, "[REDACTED_KEY]"],
  // Heartbeat ping URLs carry their token in the path; strip the path segment and any bare token.
  [/\/api\/heartbeat\/[^\s/?#"'<>]+/gi, "/api/heartbeat/[REDACTED]"],
  [/\bhb_[0-9a-f]{32}\b/gi, "[REDACTED_KEY]"],
];

function redactExtra(value: string): string {
  return EXTRA_PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), value);
}

/** Redacts credentials and bounds length. Everything an agent reads as text passes through here. */
export function safeText(value: string | null | undefined, max = MAX_FIELD_CHARS): string | null {
  if (!value) return null;
  const redacted = redactExtra(redactConnectorText(value));
  return redacted.length > max ? `${redacted.slice(0, max)}… [truncated]` : redacted;
}

/**
 * Free-form JSON as redacted text. Each string is redacted before encoding, so the patterns never meet JSON escapes
 * and the result parses unless it is cut at `max`.
 */
// The connector sanitizer's field rule ("clientSecret", "db_password"), applied to keys since values are redacted one by one.
const SECRET_KEY = /(?:token|api[_-]?key|secret|password|passwd|pwd|credentials?|authorization|cookie)$/i;

export function safeJson(value: unknown, max = MAX_FIELD_CHARS): string {
  const redact = (node: unknown): unknown =>
    typeof node === "string" ? redactExtra(redactConnectorText(node))
      : Array.isArray(node) ? node.map(redact)
      : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[REDACTED]" : redact(v)]))
      : node;
  const text = JSON.stringify(redact(value));
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

/**
 * A monitor target reduced to scheme and host. Credentials, path and query are dropped: webhook-style
 * URLs often carry their secret in the path. Anything that is not a plain http(s) URL gets host only.
 */
export function safeTarget(target: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === "http:" || url.protocol === "https:") return `${url.protocol}//${url.host}`;
  } catch {
    // fall through: host[:port] style targets (ping, port checks)
  }
  const hostPort = target.replace(/^.*@/, "").split(/[/?#\s]/)[0];
  return safeText(hostPort, 256) ?? "";
}
