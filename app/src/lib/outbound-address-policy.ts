import { Address4, Address6 } from "ip-address";
import { isIP } from "node:net";

const RESERVED_IPV4_NETWORKS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].map((network) => new Address4(network));

const RESERVED_IPV6_NETWORKS = [
  "::/96",
  "64:ff9b::/96",
  "100::/64",
  "2001::/32",
  "2001:2::/48",
  "2001:10::/28",
  "2001:20::/28",
  "2001:db8::/32",
  "2002::/16",
  "fc00::/7",
  "fec0::/10",
  "fe80::/10",
  "ff00::/8",
].map((network) => new Address6(network));

/** Classify an already-resolved address before an outbound connection. */
export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
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
