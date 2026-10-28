/** @jest-environment node */
import Redis from "ioredis";
import { randomUUID } from "node:crypto";

// Uses a disposable Redis (TEST_REDIS_URL); skipped when none is provided.
const url = process.env.TEST_REDIS_URL;
const suite = url ? describe : describe.skip;

let redis: Redis;
let namespace: string;
const foreignKey = `device-auth-fixture:foreign:${randomUUID()}`;
jest.mock("@/lib/queue", () => ({ getRedisConnection: async () => redis }));

import { allowDeviceAuthRequest } from "./device-auth-rate-limit";

suite("device auth rate limiter (real Redis)", () => {
  beforeAll(async () => {
    redis = new Redis(url!);
    await redis.set(foreignKey, "untouched", "EX", 300);
  });
  afterAll(async () => { await redis.del(foreignKey); await redis.quit(); });
  beforeEach(() => { namespace = `test-${randomUUID()}`; });
  afterEach(async () => {
    const keys = await redis.keys(`supercheck:{device-auth}:${namespace}:*`);
    if (keys.length) await redis.del(...keys);
  });

  it("does not erase unrelated keys while resetting the limiter fixtures", async () => {
    expect(await redis.get(foreignKey)).toBe("untouched");
  });

  it("allows up to max, then blocks, per subject", async () => {
    const limit = { scope: `${namespace}:t`, subject: "1.2.3.4", max: 3 };
    for (let i = 0; i < 3; i++) expect(await allowDeviceAuthRequest([limit])).toBe(true);
    expect(await allowDeviceAuthRequest([limit])).toBe(false);
    expect(await allowDeviceAuthRequest([{ ...limit, subject: "5.6.7.8" }])).toBe(true);
  });

  it("does not consume budget on any limit when one of several is exhausted", async () => {
    const tight = { scope: `${namespace}:tight`, subject: "x", max: 1 };
    const loose = { scope: `${namespace}:loose`, subject: "x", max: 10 };
    expect(await allowDeviceAuthRequest([tight, loose])).toBe(true);
    expect(await allowDeviceAuthRequest([tight, loose])).toBe(false);
    for (let i = 0; i < 9; i++) expect(await allowDeviceAuthRequest([loose])).toBe(true);
    expect(await allowDeviceAuthRequest([loose])).toBe(false); // only 1 + 9 consumed, not 11
  });

  it("hashes subjects and keeps all keys in one cluster slot", async () => {
    await allowDeviceAuthRequest([{ scope: `${namespace}:ip`, subject: "203.0.113.9", max: 5 }]);
    const keys = await redis.keys(`supercheck:{device-auth}:${namespace}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(`supercheck:{device-auth}:${namespace}:ip:`);
    expect(keys[0]).toMatch(/:[0-9a-f]{32}$/);
    expect(keys[0]).not.toContain("203.0.113.9");
    expect(await redis.pttl(keys[0])).toBeGreaterThan(0);
  });

  it("fails closed when Redis is unavailable", async () => {
    const original = redis;
    // A stub rather than a dead ioredis client: the latter leaves Jest unable to exit.
    redis = { eval: () => Promise.reject(new Error("ECONNREFUSED")) } as unknown as Redis;
    try {
      expect(await allowDeviceAuthRequest([{ scope: `${namespace}:t`, subject: "z", max: 5 }])).toBe(false);
    } finally {
      redis = original;
    }
  });
});
