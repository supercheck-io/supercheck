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
