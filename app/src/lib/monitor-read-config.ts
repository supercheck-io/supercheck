import type { MonitorConfig } from "@/db/schema";

/** Declared MonitorConfig keys, without its `[key: string]: unknown` index signature. */
type DeclaredConfigKey = keyof {
  [K in keyof MonitorConfig as string extends K ? never : number extends K ? never : K]: MonitorConfig[K];
};

/** Keys whose values are credentials or request payloads; handled separately below. */
type ProtectedConfigKey = "headers" | "body" | "auth";

/**
 * Keys visible to read-only users. This is an allowlist: a field added to
 * MonitorConfig will not compile until it is classified here, and undeclared
 * keys stored in legacy rows are never exposed to viewers.
 */
const VIEWER_VISIBLE_KEYS: Record<Exclude<DeclaredConfigKey, ProtectedConfigKey>, true> = {
  method: true,
  expectedStatusCodes: true,
  keywordInBody: true,
  keywordInBodyShouldBePresent: true,
  responseBodyJsonPath: true,
  port: true,
  protocol: true,
  expectClosed: true,
  enableSslCheck: true,
  sslDaysUntilExpirationWarning: true,
  sslCheckFrequencyHours: true,
  sslLastCheckedAt: true,
  sslCheckOnStatusChange: true,
  checkExpiration: true,
  daysUntilExpirationWarning: true,
  checkRevocation: true,
  timeoutSeconds: true,
  regions: true,
  locationConfig: true,
  retryStrategy: true,
  alertChannels: true,
  testId: true,
  testTitle: true,
  playwrightOptions: true,
};

/** Request credentials and payloads are available only to monitor updaters. */
export function monitorConfigForRead(
  config: MonitorConfig | null,
  canUpdate: boolean,
): MonitorConfig | null {
  if (!config || canUpdate) return config;
  const visible: MonitorConfig = {};
  for (const key of Object.keys(VIEWER_VISIBLE_KEYS)) {
    if (key in config) visible[key] = config[key];
  }
  if (config.auth && typeof config.auth === "object") {
    visible.auth = { type: config.auth.type };
  }
  return visible;
}

const SENSITIVE_QUERY_PARAM = /token|secret|passw|pwd|^pass$|api[-_]?key|app[-_]?key|access[-_]?key|private[-_]?key|client[-_]?key|[-_]key$|^key$|auth(?!or\b|ors\b|ority)|signature|^sig$|credential|session|jwt|^otp$|^sid$|ticket|^hash$/i;

/**
 * Credentials embedded in a monitor URL (user:pass@host, ?api_key=..., an
 * OAuth-style #fragment) are shown only to monitor updaters. Targets without
 * such parts, including non-URL targets (hostnames, ids), are returned
 * byte-for-byte unchanged.
 */
export function monitorTargetForRead(target: string, canUpdate: boolean): string;
export function monitorTargetForRead(target: string | null | undefined, canUpdate: boolean): string | null | undefined;
export function monitorTargetForRead(target: string | null | undefined, canUpdate: boolean) {
  if (!target || canUpdate) return target;
  let parsed: URL;
  try {
    // Parse rather than prefix-match: WHATWG parsing accepts forms such as
    // " https://u:p@h" and "https:/u:p@h" that carry userinfo.
    parsed = new URL(target.trim());
  } catch {
    return target;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return target;
  const sensitiveParams = [...new Set(parsed.searchParams.keys())].filter((name) => SENSITIVE_QUERY_PARAM.test(name));
  const sensitiveFragment = parsed.hash.includes("=");
  if (!parsed.username && !parsed.password && sensitiveParams.length === 0 && !sensitiveFragment) return target;
  // Keep a marker so a masked target is recognizable (the CLI warns on it)
  if (parsed.username || parsed.password) parsed.username = "REDACTED";
  parsed.password = "";
  for (const name of sensitiveParams) parsed.searchParams.set(name, "REDACTED");
  if (sensitiveFragment) parsed.hash = "REDACTED";
  return parsed.toString();
}

const SENSITIVE_RESPONSE_HEADER = /^(set-)?cookie2?$|^proxy-authorization$|authorization|authentication-info|^x-auth|token|secret|api[-_]?key|session|csrf|xsrf|jwt|signature|passw|^x-key$|^x-sid$/i;

/**
 * Stored response headers can carry session material issued to the monitor
 * (Set-Cookie, tokens). The field stays in the response, with those values
 * replaced, so API consumers keep the documented shape.
 */
export function monitorResultDetailsForRead<T extends object | null | undefined>(details: T): T {
  const headers = (details as { responseHeaders?: unknown } | null | undefined)?.responseHeaders;
  if (!details || !headers || typeof headers !== "object" || Array.isArray(headers)) return details;
  const redacted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = SENSITIVE_RESPONSE_HEADER.test(name) ? "[REDACTED]" : value;
  }
  return { ...details, responseHeaders: redacted };
}
