import { Address4, Address6 } from "ip-address";

// Ported from worker/src/common/utils/url-validator.ts (pure: no node:net).
const V4 = [
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
].map((n) => new Address4(n));

const V6 = [
  "::/96",
  "::1/128",
  "::ffff:0:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
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
].map((n) => new Address6(n));
const MAPPED = new Address6("::ffff:0:0/96");

/** True for anything that is not a plain public unicast address. Unparseable input counts as reserved. */
export function isReservedIp(ip: string): boolean {
  if (Address4.isValid(ip)) {
    const a = new Address4(ip);
    return V4.some((n) => a.isInSubnet(n));
  }
  if (Address6.isValid(ip)) {
    const a = new Address6(ip);
    // IPv4-mapped, written either as ::ffff:1.2.3.4 or as ::ffff:102:304.
    if (a.isInSubnet(MAPPED)) return isReservedIp(a.to4().correctForm());
    return V6.some((n) => a.isInSubnet(n));
  }
  return true;
}

/** Rate-limit bucket: the IPv4 address, or the /64 of an IPv6 address. */
export function ipBucket(ip: string): string | null {
  if (Address4.isValid(ip)) return ip;
  if (Address6.isValid(ip)) return new Address6(ip).canonicalForm().split(":").slice(0, 4).join(":") + "::/64";
  return null;
}
