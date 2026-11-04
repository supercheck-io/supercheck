import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

/**
 * Return a DNS lookup function that only ever answers with addresses already
 * approved by the outbound-address policy. With `options.all` (Node's
 * autoSelectFamily) every vetted address is returned so a dual-stack host can
 * fall back to a reachable family; otherwise the first one is used.
 */
export function createPinnedLookup(approved: LookupAddress | LookupAddress[]): LookupFunction {
  const addresses = (Array.isArray(approved) ? approved : [approved]).map(({ address, family }) => {
    if (family !== 4 && family !== 6) {
      throw new Error("Pinned address must use IPv4 or IPv6");
    }
    return { address, family };
  });
  if (addresses.length === 0) {
    throw new Error("Pinned lookup needs at least one address");
  }

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, addresses.map((entry) => ({ ...entry })));
      return;
    }

    callback(null, addresses[0].address, addresses[0].family);
  };
}
