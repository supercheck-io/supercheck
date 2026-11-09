import fc from "fast-check";
import { isPrivateOrReservedAddress } from "./outbound-address-policy";

// Property-based fuzzing of the SSRF address gate: alternate spellings of one
// address must never change the verdict.
const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet);
const dotted = (o: number[]) => o.join(".");
const hexWords = (o: number[]) =>
  `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;

describe("outbound address policy (fuzz)", () => {
  it("IPv4-mapped IPv6 spellings get the same verdict as the IPv4 address", () => {
    fc.assert(
      fc.property(ipv4, (o) => {
        const expected = isPrivateOrReservedAddress(dotted(o));
        for (const mapped of [
          `::ffff:${dotted(o)}`,
          `::FFFF:${hexWords(o)}`,
          `[::ffff:${hexWords(o)}]`,
        ]) {
          expect(isPrivateOrReservedAddress(mapped)).toBe(expected);
        }
      }),
    );
  });

  it("always rejects loopback, private, link-local and metadata ranges", () => {
    const privateIpv4 = fc.oneof(
      fc.tuple(fc.constant(10), octet, octet, octet),
      fc.tuple(fc.constant(127), octet, octet, octet),
      fc.tuple(fc.constant(169), fc.constant(254), octet, octet),
      fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet),
      fc.tuple(fc.constant(192), fc.constant(168), octet, octet),
    );
    fc.assert(
      fc.property(privateIpv4, (o) => {
        expect(isPrivateOrReservedAddress(dotted(o))).toBe(true);
        expect(isPrivateOrReservedAddress(`::ffff:${dotted(o)}`)).toBe(true);
      }),
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(typeof isPrivateOrReservedAddress(input)).toBe("boolean");
      }),
    );
  });
});
