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
  /^2001:(?:0|0000):/i, // Teredo
  /^2002:/i, // 6to4
  /^64:ff9b:/i, // NAT64 well-known prefix
  // AWS/Cloud metadata endpoints
  /^169\.254\.169\.254$/,
  /^metadata\.google\.internal$/i,
  /^metadata\.azure\.internal$/i,
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

/**
 * Check if a hostname resolves to a private/internal IP address
 */
export function isPrivateHost(hostname: string): boolean {
  if (isPrivateOrReservedAddress(hostname)) {
    return true;
  }

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
 * Reject non-public IP literals after DNS resolution. Keep this list aligned
 * with the app connector policy because the app and worker are independently
 * deployed packages and cannot safely share a runtime module.
 */
export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedAddress(normalized.slice('::ffff:'.length));
  }

  if (
    normalized === '::' ||
    normalized === '::1' ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2001:0000:') ||
    normalized.startsWith('2001:0:') ||
    normalized.startsWith('2002:') ||
    normalized.startsWith('64:ff9b:')
  ) {
    return true;
  }

  const parts = normalized.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (first === 192 && second === 88 && parts[2] === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && parts[2] === 100) ||
    (first === 203 && second === 0 && parts[2] === 113) ||
    first >= 224
  );
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
