import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

/**
 * Return a DNS lookup function that always uses an address already approved by
 * the outbound-address policy. Node requests an array when `options.all` is
 * enabled, so both callback forms must be supported.
 */
export function createPinnedLookup(
  approved: LookupAddress | LookupAddress[],
): LookupFunction {
  const addresses = Array.isArray(approved) ? approved : [approved];
  if (
    addresses.length === 0 ||
    addresses.some(({ family }) => family !== 4 && family !== 6)
  ) {
    throw new Error('Pinned address must use IPv4 or IPv6');
  }

  // With several approved addresses Node's autoSelectFamily can fall back between them
  // (happy eyeballs) without another DNS lookup.
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(
        null,
        addresses.map(({ address, family }) => ({ address, family })),
      );
      return;
    }

    callback(null, addresses[0].address, addresses[0].family);
  };
}
