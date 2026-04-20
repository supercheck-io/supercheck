import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * URL Validation Utilities for SSRF Protection.
 *
 * The synchronous checks are used when validating user input. For actual
 * outbound requests, `resolveWebhookUrlForOutboundRequest` adds DNS-based
 * validation and `fetchSafeExternalUrl` disables redirects.
 */

type CidrRange = readonly [baseAddress: string, prefixLength: number];

const IPV4_BLOCKED_RANGES: readonly CidrRange[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const IPV6_BLOCKED_RANGES: readonly CidrRange[] = [
  ['::', 128],
  ['::1', 128],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

const BLOCKED_HOST_PATTERNS = [
  /^metadata\.google\.internal$/i,
  /^metadata\.azure\.internal$/i,
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
];

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
];

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function extractIpv4MappedAddress(address: string): string | null {
  const normalizedAddress = normalizeHostname(address);

  // Match dotted-quad form: ::ffff:127.0.0.1
  const dottedQuadMatch = normalizedAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dottedQuadMatch) {
    return dottedQuadMatch[1] ?? null;
  }

  // Match hex form: ::ffff:7f00:1 (produced by URL.hostname canonicalization)
  // URL.hostname converts [::ffff:127.0.0.1] → [::ffff:7f00:1], which bypasses
  // the dotted-quad regex above. Convert hex groups back to dotted-quad IPv4.
  const hexMatch = normalizedAddress.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }

  return null;
}

function ipv4ToNumber(address: string): number {
  const octets = address.split('.').map((segment) => Number(segment));
  if (
    octets.length !== 4 ||
    octets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)
  ) {
    throw new Error('Invalid IPv4 address');
  }

  return octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}

function expandIpv6Address(address: string): bigint {
  const normalizedAddress = normalizeHostname(address).split('%')[0];
  const segments = normalizedAddress.split('::');

  if (segments.length > 2) {
    throw new Error('Invalid IPv6 address');
  }

  const head = segments[0] ? segments[0].split(':').filter(Boolean) : [];
  const tail = segments[1] ? segments[1].split(':').filter(Boolean) : [];
  const missingSegmentCount = 8 - (head.length + tail.length);

  if (missingSegmentCount < 0) {
    throw new Error('Invalid IPv6 address');
  }

  const expandedSegments = [
    ...head,
    ...Array(missingSegmentCount).fill('0'),
    ...tail,
  ];

  if (expandedSegments.length !== 8) {
    throw new Error('Invalid IPv6 address');
  }

  return expandedSegments.reduce(
    (result, segment) => (result << 16n) + BigInt(parseInt(segment || '0', 16)),
    0n,
  );
}

function isIpv4InRange(address: string, [baseAddress, prefixLength]: CidrRange): boolean {
  const addressNumber = ipv4ToNumber(address);
  const baseAddressNumber = ipv4ToNumber(baseAddress);
  const hostBitCount = 32 - prefixLength;
  const mask = hostBitCount === 32 ? 0 : (0xffffffff << hostBitCount) >>> 0;

  return (addressNumber & mask) === (baseAddressNumber & mask);
}

function isIpv6InRange(address: string, [baseAddress, prefixLength]: CidrRange): boolean {
  const addressNumber = expandIpv6Address(address);
  const baseAddressNumber = expandIpv6Address(baseAddress);
  const hostBitCount = 128n - BigInt(prefixLength);
  const mask =
    hostBitCount === 128n
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << hostBitCount) - 1n);

  return (addressNumber & mask) === (baseAddressNumber & mask);
}

function isPrivateIpAddress(address: string): boolean {
  const ipv4MappedAddress = extractIpv4MappedAddress(address);
  if (ipv4MappedAddress) {
    return isPrivateIpAddress(ipv4MappedAddress);
  }

  const family = isIP(normalizeHostname(address));

  if (family === 4) {
    return IPV4_BLOCKED_RANGES.some((range) => isIpv4InRange(address, range));
  }

  if (family === 6) {
    return IPV6_BLOCKED_RANGES.some((range) => isIpv6InRange(address, range));
  }

  return false;
}

const DNS_LOOKUP_TIMEOUT_MS = 5_000;

async function assertPublicDnsResolution(hostname: string): Promise<void> {
  const normalizedHostname = normalizeHostname(hostname);

  if (isIP(normalizedHostname)) {
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    // Wrap DNS lookup with its own timeout so it doesn't extend the caller's
    // outbound-request deadline. Without this, a slow/wedged resolver causes
    // the total operation to exceed the intended fetch() timeout.
    addresses = await new Promise<{ address: string; family: number }[]>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('DNS lookup timed out')),
          DNS_LOOKUP_TIMEOUT_MS,
        );
        timer.unref?.();
        lookup(normalizedHostname, { all: true, verbatim: true }).then(
          (result) => { clearTimeout(timer); resolve(result); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      },
    );
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    const detail = code ? ` (${code})` : '';
    throw new Error(`Webhook hostname could not be resolved${detail}`);
  }

  if (addresses.length === 0) {
    throw new Error('Webhook hostname could not be resolved');
  }

  if (addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new Error('Webhook hostname resolves to a private or reserved IP address');
  }
}

/**
 * Check if a hostname resolves to a private/internal IP address.
 */
export function isPrivateHost(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);

  if (BLOCKED_HOSTNAMES.includes(normalizedHostname)) {
    return true;
  }

  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))) {
    return true;
  }

  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(normalizedHostname))) {
    return true;
  }

  return isPrivateIpAddress(normalizedHostname);
}

/**
 * Validate if a URL is safe for webhook/external requests.
 */
export function isValidWebhookUrl(url: URL): { valid: boolean; error?: string } {
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!isDevelopment && url.protocol !== 'https:') {
    return { valid: false, error: 'Webhook URL must use HTTPS' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: 'Invalid protocol - only HTTP(S) allowed' };
  }

  if (isPrivateHost(url.hostname)) {
    return { valid: false, error: 'Cannot connect to private or internal networks' };
  }

  if (url.username || url.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true };
}

/**
 * Validate and sanitize a webhook URL string.
 */
export function validateWebhookUrlString(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    return isValidWebhookUrl(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Resolves a webhook destination before an outbound request so hostnames that
 * resolve to private or reserved IPs are rejected at request time.
 */
export async function resolveWebhookUrlForOutboundRequest(
  urlString: string | URL,
): Promise<URL> {
  const parsedUrl = typeof urlString === 'string' ? new URL(urlString) : new URL(urlString.toString());
  const validation = isValidWebhookUrl(parsedUrl);

  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid webhook URL');
  }

  await assertPublicDnsResolution(parsedUrl.hostname);

  return parsedUrl;
}

/**
 * Sends a validated outbound webhook request with redirects disabled so the
 * validated destination cannot be swapped via redirect chains.
 */
export async function fetchSafeExternalUrl(
  urlString: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const safeUrl = await resolveWebhookUrlForOutboundRequest(urlString);

  // lgtm[js/request-forgery] - Destination is validated before the request, including DNS resolution to block private/reserved IPs, and redirects are disabled.
  // codeql[js/request-forgery] - Arbitrary external webhook destinations are intentional here; fetchSafeExternalUrl rejects private/reserved targets before sending the request.
  return fetch(safeUrl, {
    ...init,
    redirect: 'error',
  });
}
