import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';

/**
 * URL Validation Utilities for SSRF Protection.
 *
 * The synchronous checks are used when validating user input. For actual
 * outbound requests, `resolveWebhookUrlForOutboundRequest` adds DNS-based
 * validation and `fetchSafeExternalUrl` disables redirects.
 */

type CidrRange = readonly [baseAddress: string, prefixLength: number];
type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type ResolvedPublicTarget = {
  url: URL;
  addresses: ResolvedAddress[];
};

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

function ipv4NumberToAddress(addressNumber: number): string {
  return [
    (addressNumber >>> 24) & 0xff,
    (addressNumber >>> 16) & 0xff,
    (addressNumber >>> 8) & 0xff,
    addressNumber & 0xff,
  ].join('.');
}

function extractIpv4EmbeddedAddress(address: string): string | null {
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

  if (isIP(normalizedAddress) !== 6) {
    return null;
  }

  const addressNumber = expandIpv6Address(normalizedAddress);
  const last32Bits = Number(addressNumber & 0xffffffffn);

  // IPv4-compatible IPv6 addresses (::/96), including Node's canonical
  // [::127.0.0.1] -> [::7f00:1] form, must be checked as IPv4 too.
  if ((addressNumber >> 32n) === 0n) {
    return ipv4NumberToAddress(last32Bits);
  }

  // IPv4-mapped IPv6 addresses (::ffff:0:0/96) are also canonicalized by URL.
  if ((addressNumber >> 32n) === 0xffffn) {
    return ipv4NumberToAddress(last32Bits);
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
  const ipv4EmbeddedAddress = extractIpv4EmbeddedAddress(address);
  if (ipv4EmbeddedAddress) {
    return isPrivateIpAddress(ipv4EmbeddedAddress);
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
const MAX_WEBHOOK_RESPONSE_BODY_BYTES = 1024 * 1024;

async function resolvePublicHostname(hostname: string): Promise<ResolvedAddress[]> {
  const normalizedHostname = normalizeHostname(hostname);

  if (isIP(normalizedHostname)) {
    const family = isIP(normalizedHostname);
    if (family !== 4 && family !== 6) {
      throw new Error('Webhook hostname could not be resolved');
    }

    return [{ address: normalizedHostname, family }];
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

  return addresses.map(({ address }) => {
    const family = isIP(normalizeHostname(address));
    if (family !== 4 && family !== 6) {
      throw new Error('Webhook hostname could not be resolved');
    }

    return { address, family };
  });
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
  return (await resolveWebhookTargetForOutboundRequest(urlString)).url;
}

async function resolveWebhookTargetForOutboundRequest(
  urlString: string | URL,
): Promise<ResolvedPublicTarget> {
  const parsedUrl = typeof urlString === 'string' ? new URL(urlString) : new URL(urlString.toString());
  const validation = isValidWebhookUrl(parsedUrl);

  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid webhook URL');
  }

  const addresses = await resolvePublicHostname(parsedUrl.hostname);
  if (addresses.length === 0) {
    throw new Error('Webhook hostname could not be resolved');
  }

  return { url: parsedUrl, addresses };
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

async function bodyToBuffer(body: RequestInit['body']): Promise<Buffer | undefined> {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return Buffer.from(body);
  }

  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString());
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }

  throw new Error('Unsupported webhook request body type');
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error
    && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function requestResolvedAddress(
  target: ResolvedPublicTarget,
  resolvedAddress: ResolvedAddress,
  headers: Headers,
  body: Buffer | undefined,
  init: RequestInit,
): Promise<Response> {
  const requestOptions: RequestOptions & { servername?: string } = {
    protocol: target.url.protocol,
    hostname: resolvedAddress.address,
    family: resolvedAddress.family,
    port: target.url.port || (target.url.protocol === 'https:' ? 443 : 80),
    path: `${target.url.pathname}${target.url.search}`,
    method: init.method || 'GET',
    headers: headersToObject(headers),
    signal: init.signal as AbortSignal | undefined,
  };

  if (target.url.protocol === 'https:') {
    requestOptions.servername = normalizeHostname(target.url.hostname);
  }

  const request = target.url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const req = request(requestOptions, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) {
          value.forEach((entry) => responseHeaders.append(key, entry));
        } else if (value !== undefined) {
          responseHeaders.set(key, String(value));
        }
      }

      const status = res.statusCode || 200;
      const hasNoBody =
        status === 204 ||
        status === 205 ||
        status === 304 ||
        String(init.method || 'GET').toUpperCase() === 'HEAD';

      if (hasNoBody) {
        res.resume();
        resolve(new Response(null, {
          status,
          statusText: res.statusMessage,
          headers: responseHeaders,
        }));
        return;
      }

      let responseBodyBytes = 0;
      const limitedBody = new Transform({
        transform(chunk, _encoding, callback) {
          responseBodyBytes += Buffer.byteLength(chunk);
          if (responseBodyBytes > MAX_WEBHOOK_RESPONSE_BODY_BYTES) {
            callback(new Error('Webhook response body exceeded maximum size'));
            return;
          }

          callback(null, chunk);
        },
      });

      res.on('error', (error) => limitedBody.destroy(error));
      limitedBody.on('error', () => {
        res.destroy();
      });
      res.pipe(limitedBody);

      resolve(new Response(Readable.toWeb(limitedBody) as unknown as ReadableStream, {
        status,
        statusText: res.statusMessage,
        headers: responseHeaders,
      }));
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function requestResolvedUrl(
  target: ResolvedPublicTarget,
  init: RequestInit,
): Promise<Response> {
  const body = await bodyToBuffer(init.body);
  const headers = new Headers(init.headers);

  // The TCP/TLS connection is pinned to the vetted IP, but HTTP Host and TLS SNI
  // stay bound to the original hostname so virtual hosting and cert checks work.
  headers.set('host', target.url.host);
  if (body && !headers.has('content-length')) {
    headers.set('content-length', String(body.byteLength));
  }

  let lastError: unknown;
  for (const resolvedAddress of target.addresses) {
    try {
      return await requestResolvedAddress(target, resolvedAddress, headers, body, init);
    } catch (error) {
      lastError = error;

      if (isAbortLikeError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Webhook request failed');
}

/**
 * Sends a validated outbound webhook request with redirects disabled so the
 * validated destination cannot be swapped via redirect chains.
 */
export async function fetchSafeExternalUrl(
  urlString: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const safeTarget = await resolveWebhookTargetForOutboundRequest(urlString);

  return requestResolvedUrl(safeTarget, {
    ...init,
    redirect: 'error',
  });
}
