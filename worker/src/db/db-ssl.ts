/**
 * Database SSL Configuration Utility
 *
 * - Honor sslmode in DATABASE_URL when present
 * - Self-hosted mode (SELF_HOSTED=true) → SSL OFF unless sslmode requires it
 * - Cloud mode → certificate-verified TLS ON unless sslmode=disable
 */

type PostgresSslConfig = 'verify-full' | undefined;

function isSelfHosted(): boolean {
  return ['true', '1'].includes(
    process.env.SELF_HOSTED?.trim().toLowerCase() ?? '',
  );
}

function readSslModeFromDatabaseUrl(): string | undefined {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return undefined;
  }

  try {
    const normalized = connectionString.replace(/^postgresql:/i, 'http:');
    const url = new URL(normalized);
    const sslMode = url.searchParams.get('sslmode')?.trim().toLowerCase();
    return sslMode || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @returns 'verify-full' for TLS connections, undefined for non-TLS
 */
export function getSSLConfig(): PostgresSslConfig {
  const sslMode = readSslModeFromDatabaseUrl();

  if (
    sslMode === 'disable' ||
    sslMode === 'allow' ||
    sslMode === 'prefer'
  ) {
    return undefined;
  }

  if (
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full'
  ) {
    return 'verify-full';
  }

  return isSelfHosted() ? undefined : 'verify-full';
}

export function shouldEnableSSL(): boolean {
  return getSSLConfig() === 'verify-full';
}
