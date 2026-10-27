/** @jest-environment node */
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), error: jest.fn() })),
}));

import {
  assertSreDailyTokenLimit,
  checkSreDailyTokenLimit,
  getSreDailyTokenLimit,
  recordSreTokenUsage,
  SreDailyTokenLimitError,
  sreDailyTokenLimitResponse,
} from "./sre-daily-token-limit";

const { getRedisConnection } = jest.requireMock("@/lib/queue") as { getRedisConnection: jest.Mock };

describe("SRE daily token limit", () => {
  const original = process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG;
  const exec = jest.fn().mockResolvedValue([]);
  const expire = jest.fn(() => ({ exec }));
  const incrby = jest.fn(() => ({ expire }));
  const redis = { get: jest.fn(), multi: jest.fn(() => ({ incrby })) };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG;
    getRedisConnection.mockResolvedValue(redis);
  });
  afterAll(() => {
    if (original === undefined) delete process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG;
    else process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = original;
  });

  it("parses the env limit with a default, 0 to disable, and invalid fallback", () => {
    expect(getSreDailyTokenLimit()).toBe(2_000_000);
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "5000";
    expect(getSreDailyTokenLimit()).toBe(5000);
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "0";
    expect(getSreDailyTokenLimit()).toBe(0);
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "-3";
    expect(getSreDailyTokenLimit()).toBe(2_000_000);
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "abc";
    expect(getSreDailyTokenLimit()).toBe(2_000_000);
  });

  it("allows below the limit and denies at the limit", async () => {
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "1000";
    redis.get.mockResolvedValueOnce("999");
    await expect(checkSreDailyTokenLimit("org-a")).resolves.toMatchObject({ allowed: true });
    redis.get.mockResolvedValueOnce("1000");
    const denied = await checkSreDailyTokenLimit("org-a");
    expect(denied.allowed).toBe(false);
    expect(denied.resetTime).toBeGreaterThan(Date.now());
  });

  it("scopes the counter key to the organization and UTC day", async () => {
    redis.get.mockResolvedValueOnce(null);
    await checkSreDailyTokenLimit("org-a");
    expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(/^supercheck:sre:tokens:org-a:\d{4}-\d{2}-\d{2}$/));
  });

  it("does not touch Redis when the limit is disabled", async () => {
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "0";
    await expect(checkSreDailyTokenLimit("org-a")).resolves.toMatchObject({ allowed: true });
    await recordSreTokenUsage("org-a", { totalTokens: 10 });
    expect(getRedisConnection).not.toHaveBeenCalled();
  });

  it("fails closed when Redis is unavailable or errors", async () => {
    getRedisConnection.mockResolvedValueOnce(null);
    await expect(checkSreDailyTokenLimit("org-a")).resolves.toMatchObject({ allowed: false, unavailable: true });
    redis.get.mockRejectedValueOnce(new Error("boom"));
    await expect(checkSreDailyTokenLimit("org-a")).resolves.toMatchObject({ allowed: false, unavailable: true });
  });

  it("records reported usage, falling back to input plus output, and ignores empty usage", async () => {
    await recordSreTokenUsage("org-a", { totalTokens: 120 });
    expect(incrby).toHaveBeenLastCalledWith(expect.stringContaining("org-a"), 120);
    await recordSreTokenUsage("org-a", { inputTokens: 100, outputTokens: 20 });
    expect(incrby).toHaveBeenLastCalledWith(expect.stringContaining("org-a"), 120);
    incrby.mockClear();
    await recordSreTokenUsage("org-a", undefined);
    await recordSreTokenUsage("org-a", { totalTokens: 0 });
    expect(incrby).not.toHaveBeenCalled();
  });

  it("does not hang recording when the Redis connection stalls", async () => {
    jest.useFakeTimers();
    try {
      getRedisConnection.mockReturnValueOnce(new Promise(() => undefined));
      const done = recordSreTokenUsage("org-a", { totalTokens: 5 });
      await jest.advanceTimersByTimeAsync(2_500);
      await expect(done).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("never throws when recording fails", async () => {
    exec.mockRejectedValueOnce(new Error("down"));
    await expect(recordSreTokenUsage("org-a", { totalTokens: 5 })).resolves.toBeUndefined();
  });

  it("assert throws a mapped error and the route helper returns 429 with a neutral message", async () => {
    process.env.SRE_DAILY_TOKEN_LIMIT_PER_ORG = "10";
    redis.get.mockResolvedValue("10");
    await expect(assertSreDailyTokenLimit("org-a")).rejects.toBeInstanceOf(SreDailyTokenLimitError);
    const response = await sreDailyTokenLimitResponse("org-a");
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(response?.json()).resolves.toEqual({
      error: "Daily AI usage limit reached for your organization. It resets at 00:00 UTC.",
      code: "daily_ai_limit",
    });
  });

  it("returns 503 from the route helper when the limiter is unavailable and null when allowed", async () => {
    getRedisConnection.mockResolvedValueOnce(null);
    expect((await sreDailyTokenLimitResponse("org-a"))?.status).toBe(503);
    redis.get.mockResolvedValueOnce("1");
    await expect(sreDailyTokenLimitResponse("org-a")).resolves.toBeNull();
  });

  it("fails closed instead of hanging when Redis stalls", async () => {
    jest.useFakeTimers();
    try {
      redis.get.mockReturnValueOnce(new Promise(() => {}));
      const pending = checkSreDailyTokenLimit("org-a");
      await jest.advanceTimersByTimeAsync(2_001);
      await expect(pending).resolves.toMatchObject({ allowed: false, unavailable: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
