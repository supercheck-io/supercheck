/**
 * Security-related constants
 * Includes validation rules, security thresholds, and safety limits
 */

export const SECURITY = {
  // Password and authentication
  PASSWORD_RESET_MAX_ATTEMPTS: 3,
  PASSWORD_RESET_RATE_LIMIT_WINDOW_MS: 900000, // 15 minutes

  // SSL/TLS
  SSL_DEFAULT_WARNING_DAYS: 30,
  SSL_CHECK_FREQUENCY_HOURS: 24,
  SSL_URGENT_CHECK_FREQUENCY_HOURS: 1,
  SSL_WARNING_CHECK_FREQUENCY_HOURS: 6,

  // Input validation
  MAX_STRING_LENGTH: 2048,
  MAX_HOSTNAME_LENGTH: 253,
  MIN_HOSTNAME_LENGTH: 1,

  // Port ranges
  MIN_PORT: 1,
  MAX_PORT: 65535,
  RESERVED_PORTS: [22, 23, 25, 53, 80, 110, 143, 443, 993, 995],

  // Rate limiting
  MAX_ALERTS_PER_FAILURE_SEQUENCE: 3,
  ALERT_FAILURE_THRESHOLD_DEFAULT: 1,

  // Network security
  ALLOWED_PROTOCOLS: ['http:', 'https:'] as const,
  MAX_REDIRECTS: 5,

  // Encryption
  ENCRYPTION_IV_LENGTH: 12,
  ENCRYPTION_AUTH_TAG_LENGTH: 16,
  ENCRYPTION_ALGORITHM: 'aes-128-gcm' as const,
} as const;

export const INTERNAL_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
] as const;

export const INTERNAL_IP_PATTERNS = {
  PRIVATE_10: /^10\./,
  PRIVATE_192: /^192\.168\./,
  PRIVATE_172: /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
} as const;

/**
 * Check if hostname is internal/private
 */
export function isInternalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Check exact matches
  if (INTERNAL_HOSTNAMES.some((h) => h === lower)) {
    return true;
  }

  // Check IP patterns
  return Object.values(INTERNAL_IP_PATTERNS).some((pattern) =>
    pattern.test(hostname),
  );
}
