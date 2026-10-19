jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
jest.mock("@/lib/logger", () => ({ createLogger: () => ({ error: jest.fn(), warn: jest.fn() }) }));
import { getRedisConnection } from "@/lib/queue";
import { aiRateLimiter, PLUS_TIER_LIMITS } from "./ai-rate-limiter";

describe("hourly AI token ledger", () => {
  afterEach(() => jest.restoreAllMocks());
  it("uses timestamps for expiry and sums tokens from ledger members", async () => {
    const entries: string[] = [];
    const pipeline = {
      zremrangebyscore: jest.fn(), zadd: jest.fn((_key, score: number, member: string) => { entries.push(member); expect(score).toBeGreaterThan(1_000_000_000); }),
      zrangebyscore: jest.fn(), expire: jest.fn(),
      exec: jest.fn(async () => [[null, 0], [null, 1], [null, [...entries]], [null, 1]]),
    };
    jest.mocked(getRedisConnection).mockResolvedValue({ multi: () => pipeline } as never);
    const first = await aiRateLimiter.checkAndTrackTokens("org", 123, "plus");
    expect(first.remaining).toBe(PLUS_TIER_LIMITS.tokenCostPerHour - 123);
    const second = await aiRateLimiter.checkAndTrackTokens("org", 456, "plus");
    expect(second.remaining).toBe(PLUS_TIER_LIMITS.tokenCostPerHour - 579);
    await aiRateLimiter.checkAndTrackTokens("org", PLUS_TIER_LIMITS.tokenCostPerHour - 579, "plus");
    expect((await aiRateLimiter.checkAndTrackTokens("org", 0, "plus")).allowed).toBe(false);
    expect(pipeline.zremrangebyscore).toHaveBeenCalledWith(expect.any(String), 0, expect.any(Number));
  });
  it("rejects a new provider call when its organization's token budget is exhausted", async () => {
    jest.spyOn(aiRateLimiter, "checkOrgLimit").mockResolvedValue({ allowed: true } as never);
    jest.spyOn(aiRateLimiter, "checkAndTrackTokens").mockResolvedValue({ allowed: false, limitType: "token" } as never);
    expect(await aiRateLimiter.checkRateLimit({ orgId: "org", tier: "plus" })).toMatchObject({ allowed: false, limitType: "token" });
  });
});
