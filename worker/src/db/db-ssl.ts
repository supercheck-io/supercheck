/**
 * Database SSL Configuration Utility
 *
 * Simple, robust SSL detection for PostgreSQL connections:
 * - Self-hosted mode (SELF_HOSTED=true) → SSL OFF
 * - Cloud mode (SELF_HOSTED=false or not set) → certificate-verified TLS ON
 *
 * @example
 * import { getSSLConfig } from './db-ssl';
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
 * - Cloud mode: certificate-verified TLS ON (Neon, etc.)
 *
 * @returns 'verify-full' for SSL connections, undefined for non-SSL
 */
export function getSSLConfig(): 'verify-full' | undefined {
  const isSelfHosted = ['true', '1'].includes(
    process.env.SELF_HOSTED?.trim().toLowerCase() ?? '',
  );
  return isSelfHosted ? undefined : 'verify-full';
}

/**
 * Checks if SSL should be enabled.
 * Convenience wrapper that returns a boolean.
 *
 * @returns true if SSL should be enabled
 */
export function shouldEnableSSL(): boolean {
  return getSSLConfig() === 'verify-full';
}
