import { logger } from "@/lib/logger/index";

const warned = new Set<string>();

/** Server-side, once per process: a deprecated environment variable is still being read. */
export function warnDeprecatedEnvOnce(name: string, replacement: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  logger.warn(
    `${name} is deprecated and will be removed in a future release; use ${replacement} instead.`,
  );
}

/** Test helper: forget which warnings were already emitted. */
export function resetDeprecatedEnvWarnings(): void {
  warned.clear();
}

/**
 * Public base URL for the job trigger URL shown to users. NEXT_PUBLIC_APP_URL wins;
 * NEXT_PUBLIC_BASE_URL is a deprecated fallback; otherwise the request origin.
 */
export function getJobTriggerBaseUrl(
  requestOrigin: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.NEXT_PUBLIC_APP_URL) return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  if (env.NEXT_PUBLIC_BASE_URL) {
    warnDeprecatedEnvOnce("NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_APP_URL");
    return env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  return requestOrigin;
}

/**
 * Key for hashing secrets in CLI project-config snapshots. AUTH_SECRET and NEXTAUTH_SECRET are
 * deprecated aliases of BETTER_AUTH_SECRET, kept so existing hashes do not change.
 */
export function getCliSnapshotHashKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.NOTIFICATION_CONFIG_FINGERPRINT_SECRET || env.BETTER_AUTH_SECRET;
  if (key) return key;
  for (const legacy of ["NEXTAUTH_SECRET", "AUTH_SECRET"]) {
    const value = env[legacy];
    if (value) {
      warnDeprecatedEnvOnce(legacy, "BETTER_AUTH_SECRET");
      return value;
    }
  }
  return "supercheck-cli-config-redaction-development";
}
