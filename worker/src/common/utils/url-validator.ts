import { Address4, Address6 } from 'ip-address';
import { isIP } from 'node:net';

/**
 * URL Validation Utilities for SSRF Protection (Worker-side)
 *
 * Defense-in-depth: re-validates webhook URLs at send-time to prevent
 * stored SSRF attacks, even if validation was bypassed at the API layer.
 *
 * Mirrors the validation logic from app/src/lib/url-validator.ts to stay
 * consistent (DRY across services won't work due to separate packages).
 */

const RESERVED_IPV4_NETWORKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map((network) => new Address4(network));

const RESERVED_IPV6_NETWORKS = [
  '::/96',
  '64:ff9b::/96',
  '100::/64',
  '2001::/32',
  '2001:2::/48',
  '2001:10::/28',
  '2001:20::/28',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fec0::/10',
  'fe80::/10',
  'ff00::/8',
].map((network) => new Address6(network));

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
  const family = isIP(normalized);

  if (family === 4) {
    const candidate = new Address4(normalized);
    return RESERVED_IPV4_NETWORKS.some((network) =>
      candidate.isHostInSubnet(network),
    );
  }

  if (family === 6) {
    const candidate = new Address6(normalized);
    const embeddedIpv4 = candidate.embeddedIPv4();
    if (embeddedIpv4 && candidate.isMapped4()) {
      return RESERVED_IPV4_NETWORKS.some((network) =>
        embeddedIpv4.isHostInSubnet(network),
      );
    }

    return RESERVED_IPV6_NETWORKS.some((network) =>
      candidate.isHostInSubnet(network),
    );
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
