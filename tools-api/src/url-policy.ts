import { getDomain } from "tldts";

export type Policy<T> = { ok: true; value: T } | { ok: false; reason: string };

const SPECIAL_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "onion", "test", "example", "invalid", "arpa"];
// Never loop through Cloudflare's own platforms or probe the product itself.
const OWN_SUFFIXES = ["workers.dev", "pages.dev", "app.supercheck.io", "demo.supercheck.io"];

function hasSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** Rules 4-5 on an already punycoded, lowercased hostname. Returns a reason, or null when allowed. */
export function hostReason(rawHost: string, blocked: string[]): string | null {
  const host = rawHost.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":") || /^\d+(\.\d+){3}$/.test(host)) return "ip_literal";
  if (!host.includes(".")) return "single_label";
  if (SPECIAL_SUFFIXES.some((s) => hasSuffix(host, s))) return "reserved_name";
  if (OWN_SUFFIXES.some((s) => hasSuffix(host, s))) return "reserved_name";
  if (blocked.some((s) => hasSuffix(host, s.replace(/^\./, "")))) return "blocked_host";
  return null;
}

/** Rules 1-5 and 9: parse a user or redirect URL into a checkable URL. */
export function checkUrl(input: string, blocked: string[]): Policy<URL> {
  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  // WHATWG drops the scheme's default port, so any explicit port here is non-standard.
  if (url.port !== "") return { ok: false, reason: "port" };
  url.hostname = url.hostname.replace(/\.$/, "");
  const reason = hostReason(url.hostname, blocked);
  if (reason) return { ok: false, reason };
  url.hash = "";
  return { ok: true, value: url };
}

/** Tools 6 and 8 take a bare domain; a pasted URL is reduced to its host. */
export function checkDomain(input: string, blocked: string[]): Policy<string> {
  const raw = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host: string;
  try {
    const url = new URL(candidate);
    if (url.username || url.password) return { ok: false, reason: "userinfo" };
    host = url.hostname.replace(/\.$/, "");
  } catch {
    return { ok: false, reason: "invalid_domain" };
  }
  const reason = hostReason(host, blocked);
  return reason ? { ok: false, reason } : { ok: true, value: host };
}

export function registrable(host: string): string {
  return getDomain(host) ?? host;
}
