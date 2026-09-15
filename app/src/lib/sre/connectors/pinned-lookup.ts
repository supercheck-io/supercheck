import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";

/**
 * Return a DNS lookup function that always uses an address already approved by
 * the outbound-address policy. Node requests an array when `options.all` is
 * enabled, so both callback forms must be supported.
 */
export function createPinnedLookup(selected: LookupAddress): LookupFunction {
  if (selected.family !== 4 && selected.family !== 6) {
    throw new Error("Pinned address must use IPv4 or IPv6");
  }

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [
        { address: selected.address, family: selected.family },
      ]);
      return;
    }

    callback(null, selected.address, selected.family);
  };
}
