jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));

import { getRedisConnection } from "@/lib/queue";
import { checkExecutionRateLimit } from "./execution-rate-limiter";

describe("checkExecutionRateLimit", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("checks and increments the user and organization windows atomically", async () => {
    const evalMock = jest.fn().mockResolvedValue([1, 0]);
    (getRedisConnection as jest.Mock).mockResolvedValue({ eval: evalMock });

    await expect(
      checkExecutionRateLimit("user-1", "org-1"),
    ).resolves.toMatchObject({ allowed: true });

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][0]).toContain("ZREMRANGEBYSCORE");
    expect(evalMock.mock.calls[0][0]).toContain("ZADD', KEYS[1]");
    expect(evalMock.mock.calls[0][0]).toContain("ZADD', KEYS[2]");
    expect(evalMock.mock.calls[0][2]).toBe(
      "supercheck:execution-rate:user:user-1",
    );
    expect(evalMock.mock.calls[0][3]).toBe(
      "supercheck:execution-rate:org:org-1",
    );
  });

  it("returns an accurate retry delay when either sliding window is exhausted", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    (getRedisConnection as jest.Mock).mockResolvedValue({
      eval: jest.fn().mockResolvedValue([0, 1_012_001]),
    });

    await expect(checkExecutionRateLimit("user-1", "org-1")).resolves.toEqual({
      allowed: false,
      retryAfter: 13,
      reason: "rate_limited",
    });
  });

  it("fails closed when Redis is unavailable", async () => {
    (getRedisConnection as jest.Mock).mockRejectedValue(new Error("offline"));

    await expect(
      checkExecutionRateLimit("user-1", "org-1"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "unavailable",
    });
  });
});
