import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';

const forbiddenAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],
] as const) {
  forbiddenAddresses.addSubnet(address, prefix);
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  forbiddenAddresses.addSubnet(address, prefix, 'ipv6');
}

const forbiddenHostnames = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.internal',
]);

function assertAllowedAddress(address: LookupAddress): void {
  if (
    (address.family !== 4 && address.family !== 6) ||
    isIP(address.address) !== address.family ||
    forbiddenAddresses.check(
      address.address,
      address.family === 4 ? 'ipv4' : 'ipv6',
    )
  ) {
    throw new Error(
      'Private Agent connector endpoints cannot target localhost or cloud metadata endpoints',
    );
  }
}

export function createAgentPinnedLookup(
  selected: LookupAddress,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  };
}

export async function requestPrivateAgentEndpoint<T>(
  input: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Connector endpoint must use http or https');
  }
  if (url.username || url.password) {
    throw new Error(
      'Connector endpoints cannot include credentials in the URL',
    );
  }

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (forbiddenHostnames.has(hostname) || hostname.endsWith('.localhost')) {
    throw new Error(
      'Private Agent connector endpoints cannot target localhost or cloud metadata endpoints',
    );
  }

  const family = isIP(hostname);
  const addresses: LookupAddress[] = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0)
    throw new Error('Connector endpoint did not resolve');
  addresses.forEach(assertAllowedAddress);

  // Keep the hostname in the URL for Host, SNI, and certificate validation.
  // Every DNS answer is checked; the connection uses only the chosen answer.
  const agent = new Agent({
    connect: { lookup: createAgentPinnedLookup(addresses[0]) },
  });
  try {
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      dispatcher: agent,
    } as RequestInit);
    return await read(response);
  } finally {
    // Error responses may have unread bodies; force close avoids waiting for them.
    await agent.destroy();
  }
}
