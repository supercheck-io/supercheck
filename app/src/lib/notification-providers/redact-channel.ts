import { normalizeWebhookHeaders } from "@/lib/notification-providers/validation";

const AUTH_SCHEMES = /^(bearer|basic|token|geniekey)$/i;
const SENSITIVE_NAME = /(auth|key|token|secret|password|signature|session|cookie)/i;
/** `"routing_key": "abc"` style values in a body template; templated values (`{{...}}`) are not secrets. */
const TEMPLATE_SECRET = /"([A-Za-z0-9_-]*(?:key|token|secret|password|signature)[A-Za-z0-9_-]*)"\s*:\s*"([^"{}]+)"/gi;

/**
 * The channel's own secrets removed from vendor text that may echo the request:
 * - values of sensitive-looking headers (and each word, so "GenieKey abc" drops "abc"), at any length;
 * - other header values only when long, so harmless ones ("2", "true") do not garble the text;
 * - literal key/token values in the body template (a PagerDuty routing key, for example);
 * - URL path segments, query values and password, raw, decoded and encoded (guesses, so only longer ones).
 */
export function redactChannelSecrets(text: string, config: Record<string, unknown>): string {
  const known = new Set<string>();
  const guessed = new Set<string>();
  let headers: Record<string, string> = {};
  try {
    headers = normalizeWebhookHeaders(config.headers) ?? {};
  } catch {
    // Invalid stored headers were never sent, so there is nothing of theirs to echo.
  }
  for (const [name, value] of Object.entries(headers)) {
    const target = SENSITIVE_NAME.test(name) ? known : guessed;
    target.add(value);
    for (const part of value.split(/\s+/)) if (part && !AUTH_SCHEMES.test(part)) target.add(part);
  }
  if (typeof config.bodyTemplate === "string") {
    for (const match of config.bodyTemplate.matchAll(TEMPLATE_SECRET)) known.add(match[2]);
  }
  const both = (value: string) => {
    guessed.add(value);
    try {
      guessed.add(decodeURIComponent(value));
    } catch {
      // Not valid percent-encoding: the raw form is enough.
    }
    guessed.add(encodeURIComponent(value));
  };
  try {
    const url = new URL(String(config.url ?? ""));
    for (const segment of url.pathname.split("/")) both(segment);
    for (const [, value] of new URLSearchParams(url.search)) both(value);
    for (const raw of url.search.replace(/^\?/, "").split("&")) both(raw.split("=").slice(1).join("="));
    if (url.password) both(url.password);
  } catch {
    // No usable URL: nothing more to redact.
  }
  const secrets = [...known].filter((value) => value.length > 0).concat([...guessed].filter((value) => value.length >= 8));
  return [...new Set(secrets)].sort((a, b) => b.length - a.length).reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}
