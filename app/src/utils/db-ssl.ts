/**
 * Database SSL Configuration Utility
 *
 * Simple, robust SSL detection for PostgreSQL connections:
 * - Self-hosted mode (SELF_HOSTED=true) → SSL OFF
 * - Cloud mode (SELF_HOSTED=false or not set) → SSL ON
 *
 * @example
 * import { getSSLConfig } from '@/utils/db-ssl';
 *
 * const client = postgres(connectionString, {
 *   ssl: getSSLConfig(),
 *   // ... other options
 * });
 */

/**
 * Determines the appropriate SSL configuration for PostgreSQL.
 *
 * - Self-hosted mode: SSL OFF (local PostgreSQL)
 * - Cloud mode: SSL ON (Neon, etc.)
 *
 * @returns 'require' for SSL connections, undefined for non-SSL
 */
export function getSSLConfig(): "require" | undefined {
  const isSelfHosted = process.env.SELF_HOSTED?.toLowerCase() === "true";
  return isSelfHosted ? undefined : "require";
}

/**
 * Checks if SSL should be enabled.
 * Convenience wrapper that returns a boolean.
 *
 * @returns true if SSL should be enabled
 */
export function shouldEnableSSL(): boolean {
  return getSSLConfig() === "require";
}
