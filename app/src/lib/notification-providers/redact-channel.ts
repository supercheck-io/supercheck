import { normalizeWebhookHeaders } from "@/lib/notification-providers/validation";

const AUTH_SCHEMES = /^(bearer|basic|token|geniekey)$/i;

/**
 * The channel's own secrets removed from vendor text that may echo the request: every header value (and each of its
 * words, so "GenieKey abc" also drops "abc"), plus URL path segments, query values and password, both encoded and
 * decoded. Header values are known credentials and are always redacted; URL parts are guesses, so short ones
 * ("v2", "alerts") are kept to leave the text readable.
 */
export function redactChannelSecrets(text: string, config: Record<string, unknown>): string {
  const known = new Set<string>();
  let headers: Record<string, string> = {};
  try {
    headers = normalizeWebhookHeaders(config.headers) ?? {};
  } catch {
    // Invalid stored headers were never sent, so there is nothing of theirs to echo.
  }
  for (const value of Object.values(headers)) {
    known.add(value);
    for (const part of value.split(/\s+/)) if (part && !AUTH_SCHEMES.test(part)) known.add(part);
  }
  const guessed = new Set<string>();
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
