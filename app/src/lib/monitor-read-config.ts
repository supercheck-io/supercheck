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

const SENSITIVE_QUERY_PARAM = /token|secret|passw|pwd|api[-_]?key|^key$|auth(?!or)|signature|^sig$|credential|session/i;

/**
 * Credentials embedded in a monitor URL (user:pass@host, ?api_key=...) are
 * shown only to monitor updaters. Targets without such parts, including
 * non-URL targets (hostnames, ids), are returned byte-for-byte unchanged.
 */
export function monitorTargetForRead(target: string, canUpdate: boolean): string;
export function monitorTargetForRead(target: string | null | undefined, canUpdate: boolean): string | null | undefined;
export function monitorTargetForRead(target: string | null | undefined, canUpdate: boolean) {
  if (!target || canUpdate || !/^https?:\/\//i.test(target)) return target;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return target;
  }
  const sensitiveParams = [...new Set(parsed.searchParams.keys())].filter((name) => SENSITIVE_QUERY_PARAM.test(name));
  if (!parsed.username && !parsed.password && sensitiveParams.length === 0) return target;
  parsed.username = "";
  parsed.password = "";
  for (const name of sensitiveParams) parsed.searchParams.set(name, "REDACTED");
  return parsed.toString();
}
