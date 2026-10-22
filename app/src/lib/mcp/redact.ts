import { redactConnectorText } from "@/lib/sre/connectors/output-sanitizer";

const MAX_FIELD_CHARS = 4 * 1024;


/** Extra patterns the shared connector redactor does not cover. */
const EXTRA_PATTERNS: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi, "[REDACTED_URL_CREDENTIALS]@"],
  [/\b(authorization|proxy-authorization)\s*[:=]\s*(basic|bearer|digest)\s+\S+/gi, "$1: [REDACTED]"],
  [/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, "$1: [REDACTED]"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[REDACTED_KEY]"],
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
