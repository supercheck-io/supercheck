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

const METADATA_IPV4_NETWORKS = [
  '169.254.0.0/16',
  '100.100.100.200/32',
  '168.63.129.16/32',
  '192.0.0.192/32',
].map((network) => new Address4(network));
const LINK_LOCAL_IPV6_NETWORKS = ['fe80::/10', 'fd00:ec2::254/128'].map(
  (network) => new Address6(network),
);
// Mirrors app/src/lib/sre/connectors/endpoint-policy.ts.
const NAT64_WELL_KNOWN = new Address6('64:ff9b::/96');
// Local-use NAT64: the embedded address position varies, so the whole /48 is blocked.
const NAT64_LOCAL_USE = new Address6('64:ff9b:1::/48');
const IPV4_COMPATIBLE = new Address6('::/96');
const SIX_TO_FOUR = new Address6('2002::/16');

/** IPv4 carried inside an IPv6 address by mapping, NAT64, 6to4 or the deprecated ::/96 form. */
function embeddedIpv4(candidate: Address6): Address4 | null {
  const bytes = candidate.toByteArray();
  const at = (offset: number) =>
    Address4.fromHex(
      bytes
        .slice(offset, offset + 4)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    );
  if (
    candidate.isMapped4() ||
    candidate.isHostInSubnet(IPV4_COMPATIBLE) ||
    candidate.isHostInSubnet(NAT64_WELL_KNOWN)
  )
    return at(12);
  if (candidate.isHostInSubnet(SIX_TO_FOUR)) return at(2);
  return null;
}

/** Cloud metadata and link-local addresses: blocked even when internal targets are allowed. */
export function isMetadataOrLinkLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(normalized);
  if (family === 4) {
    const candidate = new Address4(normalized);
    return METADATA_IPV4_NETWORKS.some((n) => candidate.isHostInSubnet(n));
  }
  if (family === 6) {
    const candidate = new Address6(normalized);
    const embedded = embeddedIpv4(candidate);
    if (
      embedded &&
      METADATA_IPV4_NETWORKS.some((n) => embedded.isHostInSubnet(n))
    )
      return true;
    return (
      candidate.isHostInSubnet(NAT64_LOCAL_USE) ||
      LINK_LOCAL_IPV6_NETWORKS.some((n) => candidate.isHostInSubnet(n))
    );
  }
  return false;
}

function isMetadataHost(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
  return (
    isMetadataOrLinkLocalAddress(normalized) ||
    /^metadata\.(google|azure)\.internal$/.test(normalized)
  );
}

/**
 * Same rule as the app: only a self-hosted install with ALLOW_INTERNAL_TARGETS exactly "true"
 * may point webhook channels at private hosts and plain http.
 */
export function allowInternalWebhookTargets(): boolean {
  const selfHosted = ['true', '1'].includes(
    (process.env.SELF_HOSTED ?? '').trim().toLowerCase(),
  );
  return selfHosted && process.env.ALLOW_INTERNAL_TARGETS === 'true';
}

/**
 * Validate if a URL is safe for outbound webhook requests.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export function isUrlSafeForOutbound(
  urlString: string,
  options: { allowInternal?: boolean } = {},
): {
  safe: boolean;
  reason?: string;
} {
  try {
    const url = new URL(urlString);

    // Only allow HTTP(S)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { safe: false, reason: 'Invalid protocol' };
    }

    // Block private/internal hosts (metadata and link-local stay blocked when internal is allowed)
    if (
      options.allowInternal
        ? isMetadataHost(url.hostname)
        : isPrivateHost(url.hostname)
    ) {
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
