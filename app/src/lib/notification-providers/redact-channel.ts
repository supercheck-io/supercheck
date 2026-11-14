import { normalizeWebhookHeaders } from "@/lib/notification-providers/validation";

/** The channel's own secrets (header values, URL path segments and query values) removed from vendor text that may echo the request. */
export function redactChannelSecrets(text: string, config: Record<string, unknown>): string {
  const secrets = new Set<string>();
  for (const value of Object.values(normalizeWebhookHeaders(config.headers) ?? {})) {
    secrets.add(value);
    for (const part of value.split(/\s+/)) secrets.add(part);
  }
  try {
    const url = new URL(String(config.url ?? ""));
    for (const segment of url.pathname.split("/")) secrets.add(decodeURIComponent(segment));
    for (const value of url.searchParams.values()) secrets.add(value);
    if (url.password) secrets.add(url.password);
  } catch {
    // No usable URL: nothing more to redact.
  }
  // Short values (path words like "v2", "alerts") are not secrets and would garble the text.
  return [...secrets].filter((secret) => secret.length >= 8).sort((a, b) => b.length - a.length).reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}
