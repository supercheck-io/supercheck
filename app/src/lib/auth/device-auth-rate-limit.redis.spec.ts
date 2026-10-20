/** @jest-environment node */
import Redis from "ioredis";

// Uses a disposable Redis (TEST_REDIS_URL); skipped when none is provided.
const url = process.env.TEST_REDIS_URL;
const suite = url ? describe : describe.skip;

let redis: Redis;
jest.mock("@/lib/queue", () => ({ getRedisConnection: async () => redis }));

import { allowDeviceAuthRequest } from "./device-auth-rate-limit";

suite("device auth rate limiter (real Redis)", () => {
  beforeAll(() => { redis = new Redis(url!); });
  afterAll(async () => { await redis.quit(); });
  beforeEach(async () => { await redis.flushall(); });

  it("allows up to max, then blocks, per subject", async () => {
    const limit = { scope: "t", subject: "1.2.3.4", max: 3 };
    for (let i = 0; i < 3; i++) expect(await allowDeviceAuthRequest([limit])).toBe(true);
    expect(await allowDeviceAuthRequest([limit])).toBe(false);
    expect(await allowDeviceAuthRequest([{ ...limit, subject: "5.6.7.8" }])).toBe(true);
  });

  it("does not consume budget on any limit when one of several is exhausted", async () => {
    const tight = { scope: "tight", subject: "x", max: 1 };
    const loose = { scope: "loose", subject: "x", max: 10 };
    expect(await allowDeviceAuthRequest([tight, loose])).toBe(true);
    expect(await allowDeviceAuthRequest([tight, loose])).toBe(false);
    for (let i = 0; i < 9; i++) expect(await allowDeviceAuthRequest([loose])).toBe(true);
    expect(await allowDeviceAuthRequest([loose])).toBe(false); // only 1 + 9 consumed, not 11
  });

  it("hashes subjects and keeps all keys in one cluster slot", async () => {
    await allowDeviceAuthRequest([{ scope: "ip", subject: "203.0.113.9", max: 5 }]);
    const keys = await redis.keys("*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^supercheck:\{device-auth\}:ip:[0-9a-f]{32}$/);
    expect(keys[0]).not.toContain("203.0.113.9");
    expect(await redis.pttl(keys[0])).toBeGreaterThan(0);
  });

  it("fails closed when Redis is unavailable", async () => {
    const original = redis;
    redis = new Redis("redis://127.0.0.1:1", { maxRetriesPerRequest: 0, lazyConnect: true, retryStrategy: () => null });
    try {
      expect(await allowDeviceAuthRequest([{ scope: "t", subject: "z", max: 5 }])).toBe(false);
    } finally {
      redis.disconnect();
      redis = original;
    }
  });
});
