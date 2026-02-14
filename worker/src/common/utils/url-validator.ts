/**
 * URL Validation Utilities for SSRF Protection (Worker-side)
 *
 * Defense-in-depth: re-validates webhook URLs at send-time to prevent
 * stored SSRF attacks, even if validation was bypassed at the API layer.
 *
 * Mirrors the validation logic from app/src/lib/url-validator.ts to stay
 * consistent (DRY across services won't work due to separate packages).
 */

// Private IP ranges that should not be accessible via webhooks
const PRIVATE_IP_PATTERNS = [
  // Loopback
  /^127\./,
  /^::1$/,
  /^localhost$/i,
  // Private Class A
  /^10\./,
  // Private Class B
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  // Private Class C
  /^192\.168\./,
  // Link-local
  /^169\.254\./,
  // IPv6 private
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
  // AWS/Cloud metadata endpoints
  /^169\.254\.169\.254$/,
  /^metadata\.google\.internal$/i,
  /^metadata\.azure\.internal$/i,
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
];

/**
 * Check if a hostname resolves to a private/internal IP address
 */
export function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate if a URL is safe for outbound webhook requests.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export function isUrlSafeForOutbound(urlString: string): {
  safe: boolean;
  reason?: string;
} {
  try {
    const url = new URL(urlString);

    // Only allow HTTP(S)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { safe: false, reason: 'Invalid protocol' };
    }

    // Block private/internal hosts
    if (isPrivateHost(url.hostname)) {
      return {
        safe: false,
        reason: 'Cannot send to private or internal networks',
      };
    }

    // Block URLs with embedded credentials
    if (url.username || url.password) {
      return {
        safe: false,
        reason: 'URLs with embedded credentials are not allowed',
      };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }
}
