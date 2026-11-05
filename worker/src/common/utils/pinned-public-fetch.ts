import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import { createPinnedLookup } from './pinned-lookup';
import {
  isMetadataOrLinkLocalAddress,
  isPrivateOrReservedAddress,
} from './url-validator';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function allowsDevelopmentPrivateNetworks() {
  const selfHosted =
    process.env.SELF_HOSTED === 'true' || process.env.SELF_HOSTED === '1';
  return process.env.NODE_ENV === 'development' && selfHosted;
}

/** Rejects when the signal aborts so a slow DNS answer cannot outlive the caller's timeout. */
function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new Error('Webhook request aborted'),
      );
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function fetchPublicEndpoint(
  input: string | URL,
  init: RequestInit = {},
  // Webhook channels on an opted-in self-hosted install: http and private hosts, never metadata.
  options: { allowInternal?: boolean } = {},
): Promise<Response> {
  const url = new URL(input);
  const { allowInternal = false } = options;
  if (allowsDevelopmentPrivateNetworks()) return fetch(url, init);
  if (url.protocol !== 'https:' && !(allowInternal && url.protocol === 'http:'))
    throw new Error('Webhook URL must use HTTPS');

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await abortable(
        lookup(hostname, { all: true, verbatim: true }),
        init.signal,
      );
  // Metadata addresses are refused in both modes; the private ranges only when internal targets are not allowed.
  const blocked = (address: string) =>
    isMetadataOrLinkLocalAddress(address) ||
    (!allowInternal && isPrivateOrReservedAddress(address));
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => blocked(address))
  ) {
    throw new Error('Cannot send to private or internal networks');
  }

  const headers = new Headers(init.headers);
  headers.set('Accept-Encoding', 'identity');
  if (typeof init.body === 'string')
    headers.set('Content-Length', String(Buffer.byteLength(init.body)));

  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'http:' ? http : https).request(
      url,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        lookup: createPinnedLookup(addresses),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Webhook response exceeded 10 MiB'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const status = response.statusCode ?? 500;
            // Fetch forbids bodies for these statuses, including an empty Buffer.
            const body =
              [204, 205, 304].includes(status) ||
              init.method?.toUpperCase() === 'HEAD'
                ? null
                : Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status,
                statusText: response.statusMessage,
                headers: response.headers as HeadersInit,
              }),
            );
          } catch (error) {
            // Event callbacks run outside the Promise executor's catch boundary.
            reject(
              error instanceof Error
                ? error
                : new Error('Invalid webhook response'),
            );
          }
        });
      },
    );
    request.on('error', reject);
    if (init.signal) {
      const abort = () => {
        const reason: unknown = init.signal?.reason;
        request.destroy(
          reason instanceof Error
            ? reason
            : new Error('Webhook request aborted'),
        );
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
      request.on('close', () =>
        init.signal?.removeEventListener('abort', abort),
      );
    }
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== 'string' && !Buffer.isBuffer(init.body)) {
        request.destroy(new Error('Unsupported webhook request body'));
        return;
      }
      request.write(init.body);
    }
    request.end();
  });
}
