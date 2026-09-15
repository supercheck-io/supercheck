jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(),
}));

jest.mock("@/lib/logger/index", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import { checkSreChatRateLimit } from "./sre-rate-limiter";

const { getRedisConnection: mockGetRedisConnection } = jest.requireMock(
  "@/lib/queue",
) as {
  getRedisConnection: jest.Mock;
};

const { createLogger: mockCreateLogger } = jest.requireMock(
  "@/lib/logger/index",
) as {
  createLogger: jest.Mock;
};

const mockSreRateLimitLogger = mockCreateLogger.mock.results[0].value as {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

describe("checkSreChatRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fails closed and logs an alertable event when Redis is unavailable", async () => {
    mockGetRedisConnection.mockResolvedValueOnce(null);

    const result = await checkSreChatRateLimit("user-1");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.unavailable).toBe(true);
    expect(result.resetTime).toBeGreaterThan(Date.now());
    expect(mockSreRateLimitLogger.warn).toHaveBeenCalledWith(
      {
        event: "sre_rate_limiter_unavailable",
        key: "chat:user-1",
        reason: "redis_unavailable",
        error: undefined,
      },
      "Redis unavailable for SRE rate limiting, denying request",
    );
  });

  it("fails closed and logs an alertable event when Redis transaction execution fails", async () => {
    mockGetRedisConnection.mockResolvedValueOnce({
      eval: jest.fn().mockResolvedValueOnce(null),
    });

    const result = await checkSreChatRateLimit("user-2");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.unavailable).toBe(true);
    expect(result.resetTime).toBeGreaterThan(Date.now());
    expect(mockSreRateLimitLogger.warn).toHaveBeenCalledWith(
      {
        event: "sre_rate_limiter_unavailable",
        key: "chat:user-2",
        reason: "redis_transaction_failed",
        error: undefined,
      },
      "Redis transaction failed for SRE rate limiting, denying request",
    );
  });

  it("uses one atomic Redis script for admission and expiry", async () => {
    const evalCommand = jest.fn().mockResolvedValueOnce([1, 1, Date.now()]);
    mockGetRedisConnection.mockResolvedValueOnce({ eval: evalCommand });

    const result = await checkSreChatRateLimit("user-atomic");

    expect(result).toEqual({ allowed: true, remaining: 29 });
    expect(evalCommand).toHaveBeenCalledTimes(1);
    expect(evalCommand.mock.calls[0][1]).toBe(1);
    expect(evalCommand.mock.calls[0][2]).toBe(
      "supercheck:sre:ratelimit:chat:user-atomic",
    );
  });

  it("returns the atomic script reset time when the limit is reached", async () => {
    const oldest = Date.now() - 1_000;
    mockGetRedisConnection.mockResolvedValueOnce({
      eval: jest.fn().mockResolvedValueOnce([0, 30, oldest]),
    });

    const result = await checkSreChatRateLimit("user-limited");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetTime).toBe(oldest + 60_000);
  });

  it("fails closed and logs an alertable event when Redis throws", async () => {
    const error = new Error("redis down");
    mockGetRedisConnection.mockRejectedValueOnce(error);

    const result = await checkSreChatRateLimit("user-3");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.unavailable).toBe(true);
    expect(result.resetTime).toBeGreaterThan(Date.now());
    expect(mockSreRateLimitLogger.error).toHaveBeenCalledWith(
      {
        event: "sre_rate_limiter_unavailable",
        key: "chat:user-3",
        reason: "redis_error",
        error,
      },
      "SRE rate limiting error, denying request",
    );
  });
});
