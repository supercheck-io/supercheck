import { getClientIP } from "@/lib/session-security";

const ORIGINAL_ENV = { ...process.env };

const headers = (values: Record<string, string>) => {
  const result = new Headers();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};

beforeEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUST_CF_CONNECTING_IP;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getClientIP", () => {
  it("returns unknown without a forwarded header", () => {
    expect(getClientIP(new Headers())).toBe("unknown");
  });

  it("ignores the client-supplied leftmost entry", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const result = getClientIP(
      headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 198.51.100.7" })
    );
    expect(result).toBe("203.0.113.9");
  });

  it("uses the rightmost entry by default (one proxy appends the client address)", () => {
    const result = getClientIP(
      headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 198.51.100.7" })
    );
    expect(result).toBe("198.51.100.7");
  });

  it("skips two trusted proxy hops", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const result = getClientIP(
      headers({
        "x-forwarded-for": "6.6.6.6, 203.0.113.9, 198.51.100.7, 192.0.2.44",
      })
    );
    expect(result).toBe("203.0.113.9");
  });

  it("uses the rightmost entry when no proxy hop is trusted", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(
      getClientIP(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))
    ).toBe("203.0.113.9");
    expect(getClientIP(headers({ "x-forwarded-for": "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  it("falls back to the default hop count for invalid configuration", () => {
    process.env.TRUSTED_PROXY_HOPS = "two";
    expect(
      getClientIP(
        headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 198.51.100.7" })
      )
    ).toBe("198.51.100.7");
  });

  it("handles IPv6 entries", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(
      getClientIP(
        headers({ "x-forwarded-for": "6.6.6.6, 2001:db8::1, 2001:db8::2" })
      )
    ).toBe("2001:db8::1");

    expect(
      getClientIP(headers({ "x-forwarded-for": "6.6.6.6, [2001:db8::1]:443" }))
    ).toBe("6.6.6.6");
  });

  it("returns unknown for a garbage header", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(
      getClientIP(headers({ "x-forwarded-for": "not-an-ip, still-not-an-ip" }))
    ).toBe("unknown");
  });

  it("returns unknown when the trusted hop count consumes the header", () => {
    process.env.TRUSTED_PROXY_HOPS = "3";
    expect(getClientIP(headers({ "x-forwarded-for": "203.0.113.9" }))).toBe(
      "unknown"
    );
  });

  it("ignores CF-Connecting-IP unless explicitly trusted", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    const requestHeaders = headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.7",
    });

    expect(getClientIP(requestHeaders)).toBe("198.51.100.7");

    process.env.TRUST_CF_CONNECTING_IP = "true";
    expect(getClientIP(requestHeaders)).toBe("203.0.113.9");
  });

  it("falls back to X-Forwarded-For when CF-Connecting-IP is invalid", () => {
    process.env.TRUST_CF_CONNECTING_IP = "true";
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(
      getClientIP(
        headers({
          "cf-connecting-ip": "not-an-ip",
          "x-forwarded-for": "203.0.113.9",
        })
      )
    ).toBe("203.0.113.9");
  });
});
