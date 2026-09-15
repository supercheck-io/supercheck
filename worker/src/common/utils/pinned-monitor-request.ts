import { lookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import {
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import { createPinnedLookup } from './pinned-lookup';
import { isPrivateOrReservedAddress } from './url-validator';

type RequestExecutor = (
  config: AxiosRequestConfig,
) => Promise<AxiosResponse>;

export interface PinnedMonitorRequestOptions {
  allowInternalTargets: boolean;
  maxRedirects: number;
}

interface PinnedConfig {
  config: AxiosRequestConfig;
  destroyAgents: () => void;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
];

async function pinRequestConfig(
  input: AxiosRequestConfig,
  allowInternalTargets: boolean,
): Promise<PinnedConfig> {
  if (!input.url) throw new Error('Monitor URL is required');

  const url = new URL(input.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Monitor URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Monitor URLs cannot include credentials');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new Error('Monitor target did not resolve to an address');
  }
  if (
    !allowInternalTargets &&
    addresses.some(({ address }) => isPrivateOrReservedAddress(address))
  ) {
    throw new Error('Access to private or reserved networks is not allowed');
  }

  // Prefer IPv4 where available to preserve existing monitor behavior in
  // regions without reliable IPv6 routing, while still supporting IPv6-only hosts.
  const selected =
    addresses.find(({ family }) => family === 4) ?? addresses[0];
  const pinnedLookup = createPinnedLookup(selected);

  const httpAgent = new HttpAgent({ lookup: pinnedLookup });
  const httpsAgent = new HttpsAgent({ lookup: pinnedLookup });

  return {
    config: {
      ...input,
      url: url.toString(),
      httpAgent,
      httpsAgent,
      maxRedirects: 0,
      // A proxy would perform a separate DNS lookup and bypass address pinning.
      proxy: false,
    },
    destroyAgents: () => {
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}

function redirectLocation(response: AxiosResponse): string | undefined {
  const value = response.headers?.location;
  return Array.isArray(value) ? value[0] : value;
}

function buildRedirectConfig(
  previous: AxiosRequestConfig,
  currentUrl: URL,
  nextUrl: URL,
  status: number,
): AxiosRequestConfig {
  const headers = AxiosHeaders.from(previous.headers as AxiosHeaders | undefined);
  headers.delete('host');

  const crossOrigin = currentUrl.origin !== nextUrl.origin;

  if (crossOrigin) {
    for (const header of SENSITIVE_REDIRECT_HEADERS) headers.delete(header);
  }

  const method = String(previous.method ?? 'GET').toUpperCase();
  const switchToGet =
    (status === 303 && method !== 'HEAD') ||
    ((status === 301 || status === 302) && method === 'POST');
  if (switchToGet) {
    headers.delete('content-length');
    headers.delete('content-type');
  }

  return {
    ...previous,
    url: nextUrl.toString(),
    method: switchToGet ? 'GET' : previous.method,
    data: switchToGet ? undefined : previous.data,
    headers,
    // Axios turns `auth` back into an Authorization header at dispatch time.
    // Remove it as well as the header when a redirect changes origin.
    auth: crossOrigin ? undefined : previous.auth,
  };
}

/**
 * Execute an HTTP monitor after resolving and pinning every destination.
 * Redirects are followed explicitly so each hop receives the same SSRF check.
 */
export async function requestPinnedMonitorTarget(
  initialConfig: AxiosRequestConfig,
  options: PinnedMonitorRequestOptions,
  execute: RequestExecutor,
): Promise<AxiosResponse> {
  let requestConfig = initialConfig;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const currentUrl = new URL(String(requestConfig.url));
    const pinned = await pinRequestConfig(
      requestConfig,
      options.allowInternalTargets,
    );

    let response: AxiosResponse;
    try {
      response = await execute(pinned.config);
    } finally {
      pinned.destroyAgents();
    }

    const location = redirectLocation(response);
    if (!location || !REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount >= options.maxRedirects) {
      throw new Error('Monitor target exceeded the redirect limit');
    }

    const nextUrl = new URL(location, currentUrl);
    requestConfig = buildRedirectConfig(
      requestConfig,
      currentUrl,
      nextUrl,
      response.status,
    );
  }
}
