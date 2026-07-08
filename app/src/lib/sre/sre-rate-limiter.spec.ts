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
    const multi = {
      zremrangebyscore: jest.fn(),
      zcard: jest.fn(),
      zrange: jest.fn(),
      exec: jest.fn().mockResolvedValueOnce(null),
    };
    mockGetRedisConnection.mockResolvedValueOnce({
      multi: jest.fn(() => multi),
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
