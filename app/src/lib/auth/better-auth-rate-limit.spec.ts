/** @jest-environment node */
const store = new Map<string, number>();
const redis = {
  status: "ready",
  eval: jest.fn(async (_script: string, _n: number, key: string) => {
    const count = (store.get(key) ?? 0) + 1;
    store.set(key, count);
    return [count, 7];
  }),
};
let redisAvailable = true;
jest.mock("@/lib/queue", () => ({
  getRedisConnection: async () => {
    if (!redisAvailable) throw new Error("ECONNREFUSED");
    return redis;
  },
}));

import { AUTH_CLIENT_IP_HEADER, betterAuthRateLimitStorage, withAuthClientIp } from "./better-auth-rate-limit";

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  redisAvailable = true;
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUST_CF_CONNECTING_IP;
});

describe("withAuthClientIp", () => {
  it("replaces a client-sent header with the IP the proxy-trust rules resolve", () => {
    const req = withAuthClientIp(new Request("https://app.test/api/auth/ok", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.5", [AUTH_CLIENT_IP_HEADER]: "1.1.1.1" },
    }));
    expect(req.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
  });

  it("drops a client-sent header when no trustworthy IP exists", () => {
    const req = withAuthClientIp(new Request("https://app.test/api/auth/ok", { headers: { [AUTH_CLIENT_IP_HEADER]: "1.1.1.1" } }));
    expect(req.headers.has(AUTH_CLIENT_IP_HEADER)).toBe(false);
  });

  it("copies the Proxy-wrapped requests Next.js hands route handlers, keeping raw body bytes", async () => {
    const { NextRequest } = await import("next/server");
    const original = new NextRequest("https://app.test/api/auth/polar/webhooks", {
      method: "POST",
      body: new Uint8Array([1, 2, 255]),
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    // Same handler shape as Next's proxyNextRequest; `new Request(proxy, init)` throws on Node 24.
    const proxied = new Proxy(original, { get: (target, prop) => Reflect.get(target, prop, target) });
    const req = withAuthClientIp(proxied);
    expect(req.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
    expect([...new Uint8Array(await req.arrayBuffer())]).toEqual([1, 2, 255]);
  });

  it("keeps the method and body", async () => {
    const req = withAuthClientIp(new Request("https://app.test/api/auth/sign-in/email", { method: "POST", body: "{\"a\":1}" }));
    expect(req.method).toBe("POST");
    await expect(req.text()).resolves.toBe("{\"a\":1}");
  });
});

describe("betterAuthRateLimitStorage", () => {
  it("allows up to max per key across callers, then reports retryAfter from the window TTL", async () => {
    const rule = { window: 10, max: 2 };
    await expect(betterAuthRateLimitStorage.consume("1.2.3.4|/sign-in/email", rule)).resolves.toEqual({ allowed: true, retryAfter: null });
    await expect(betterAuthRateLimitStorage.consume("1.2.3.4|/sign-in/email", rule)).resolves.toEqual({ allowed: true, retryAfter: null });
    await expect(betterAuthRateLimitStorage.consume("1.2.3.4|/sign-in/email", rule)).resolves.toEqual({ allowed: false, retryAfter: 7 });
    await expect(betterAuthRateLimitStorage.consume("5.6.7.8|/sign-in/email", rule)).resolves.toEqual({ allowed: true, retryAfter: null });
  });

  it("falls back to the rule window when the key has no TTL", async () => {
    redis.eval.mockResolvedValueOnce([3, -1]);
    await expect(betterAuthRateLimitStorage.consume("k", { window: 60, max: 2 })).resolves.toEqual({ allowed: false, retryAfter: 60 });
  });

  it("does not enforce the shared bucket Better Auth uses when no client IP is trusted", async () => {
    await expect(betterAuthRateLimitStorage.consume("no-trusted-ip|/sign-in/email", { window: 10, max: 0 })).resolves.toEqual({ allowed: true, retryAfter: null });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("never puts the raw key (client IP) in Redis", async () => {
    await betterAuthRateLimitStorage.consume("1.2.3.4|/sign-in/email", { window: 10, max: 2 });
    expect([...store.keys()].join()).not.toContain("1.2.3.4");
  });

  it("fails open when Redis is unavailable", async () => {
    redisAvailable = false;
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(betterAuthRateLimitStorage.consume("k", { window: 10, max: 0 })).resolves.toEqual({ allowed: true, retryAfter: null });
  });
});

describe("withAuthClientIp with trusted proxy hops", () => {
  it("resolves the trusted entry from a multi-hop chain", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const req = withAuthClientIp(new Request("https://app.test/api/auth/oauth2/token", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.5, 10.0.0.1" },
    }));
    expect(req.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
  });
});
