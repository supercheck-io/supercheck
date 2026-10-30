import { isSelfHosted } from "@/lib/feature-flags";

/**
 * Database SSL Configuration Utility (mirrors worker/src/db/db-ssl.ts)
 *
 * - sslmode in DATABASE_URL wins when present. postgres.js ignores it once an
 *   ssl option is passed, so it is read here.
 * - Self-hosted mode (SELF_HOSTED=true) → SSL OFF unless sslmode requires it
 * - Cloud mode → certificate-verified TLS ON unless sslmode disables it
 *
 * @example
 * const client = postgres(connectionString, { ssl: getSSLConfig() });
 */

function readSslModeFromDatabaseUrl(): string | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  try {
    const url = new URL(connectionString.replace(/^postgres(ql)?:/i, "http:"));
    return url.searchParams.get("sslmode")?.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @returns 'verify-full' (verified TLS), 'prefer' (opportunistic TLS), or undefined (no TLS)
 */
export function getSSLConfig(): "verify-full" | "prefer" | undefined {
  const sslMode = readSslModeFromDatabaseUrl();
  if (sslMode === "disable") return undefined;
  // postgres.js ignores ?sslmode= once ssl is passed: keep opportunistic TLS (no cert check).
  if (sslMode === "allow" || sslMode === "prefer") return "prefer";
  // verify-ca is verified as verify-full: postgres.js has no CA-only mode.
  if (sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full") {
    return "verify-full";
  }
  return isSelfHosted() ? undefined : "verify-full";
}

/**
 * Checks if SSL should be enabled.
 *
 * @returns true if SSL should be enabled
 */
export function shouldEnableSSL(): boolean {
  return getSSLConfig() !== undefined;
}
