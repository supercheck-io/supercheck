import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

import { isPrivateOrReservedAddress } from './url-validator';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function allowsDevelopmentPrivateNetworks() {
  const selfHosted =
    process.env.SELF_HOSTED === 'true' || process.env.SELF_HOSTED === '1';
  return process.env.NODE_ENV === 'development' && selfHosted;
}

export async function fetchPublicEndpoint(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input);
  if (allowsDevelopmentPrivateNetworks()) return fetch(url, init);
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateOrReservedAddress(address))
  ) {
    throw new Error('Cannot send to private or internal networks');
  }

  const selected = addresses[0];
  const headers = new Headers(init.headers);
  headers.set('Accept-Encoding', 'identity');

  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        lookup: (_hostname, _options, callback) =>
          callback(null, selected.address, selected.family),
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
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on('error', reject);
    if (init.signal) {
      const abort = () => request.destroy(init.signal?.reason);
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
