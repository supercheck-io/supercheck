jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));

import { getRedisConnection } from "@/lib/queue";
import { apiKeyRateLimiter } from "./api-key-rate-limiter";

describe("ApiKeyRateLimiter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses one Lua decision for remove, count, and add", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const evalMock = jest.fn().mockResolvedValue([1, 1, 950]);
    (getRedisConnection as jest.Mock).mockResolvedValue({ eval: evalMock });

    const result = await apiKeyRateLimiter.checkAndIncrement("key-1", {
      enabled: true,
      timeWindow: 60,
      maxRequests: 10,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetAt).toEqual(new Date(1_010_000));
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][0]).toContain("ZREMRANGEBYSCORE");
    expect(evalMock.mock.calls[0][0]).toContain("ZADD");
  });

  it("uses the oldest request to calculate denied reset and retry headers", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    (getRedisConnection as jest.Mock).mockResolvedValue({
      eval: jest.fn().mockResolvedValue([0, 10, 980]),
    });

    await expect(
      apiKeyRateLimiter.checkAndIncrement("key-1", {
        enabled: true,
        timeWindow: 60,
        maxRequests: 10,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      retryAfter: 40,
      resetAt: new Date(1_040_000),
    });
  });

  it("fails closed when Redis is unavailable", async () => {
    (getRedisConnection as jest.Mock).mockRejectedValue(new Error("offline"));

    await expect(
      apiKeyRateLimiter.checkAndIncrement("key-1", {
        enabled: true,
        timeWindow: 60,
        maxRequests: 10,
      }),
    ).resolves.toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 });
  });
});
