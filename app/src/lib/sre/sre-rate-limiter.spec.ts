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

import { checkSreChatRateLimit, checkSreIncidentUpdateRateLimit } from "./sre-rate-limiter";

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
      status: "ready",
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
    mockGetRedisConnection.mockResolvedValueOnce({ status: "ready", eval: evalCommand });

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
      status: "ready",
      eval: jest.fn().mockResolvedValueOnce([0, 30, oldest]),
    });

    const result = await checkSreChatRateLimit("user-limited");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetTime).toBe(oldest + 60_000);
  });

  // A client mid-reconnect: `ready` fires the listener registered by waitForRedisReady.
  function reconnectingClient(evalCommand: jest.Mock) {
    const listeners: Record<string, () => void> = {};
    const client = {
      status: "reconnecting",
      eval: evalCommand,
      once: (event: string, fn: () => void) => { listeners[event] = fn; },
      off: jest.fn(),
    };
    const becomeReady = () => { client.status = "ready"; listeners.ready?.(); };
    return { client, becomeReady };
  }

  it("rides out a short failover and then counts the request", async () => {
    const evalCommand = jest.fn().mockResolvedValueOnce([1, 1, Date.now()]);
    const { client, becomeReady } = reconnectingClient(evalCommand);
    mockGetRedisConnection.mockResolvedValueOnce(client);

    const pending = checkSreChatRateLimit("user-failover");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(evalCommand).not.toHaveBeenCalled();
    becomeReady();

    await expect(pending).resolves.toEqual({ allowed: true, remaining: 29 });
  });

  it("fails closed without calling Redis when the client stays down past the wait", async () => {
    jest.useFakeTimers();
    try {
      const evalCommand = jest.fn();
      mockGetRedisConnection.mockResolvedValueOnce(reconnectingClient(evalCommand).client);

      const pending = checkSreChatRateLimit("user-reconnecting");
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toMatchObject({ allowed: false, unavailable: true });
      expect(evalCommand).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("fails closed when Redis never answers instead of hanging the request", async () => {
    jest.useFakeTimers();
    try {
      mockGetRedisConnection.mockResolvedValueOnce({
        status: "ready",
        eval: jest.fn(() => new Promise(() => {})),
      });

      const pending = checkSreChatRateLimit("user-hung");
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toMatchObject({ allowed: false, unavailable: true });
    } finally {
      jest.useRealTimers();
    }
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

describe("checkSreIncidentUpdateRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows writes under the limit", async () => {
    mockGetRedisConnection.mockResolvedValueOnce({
      status: "ready",
      eval: jest.fn().mockResolvedValueOnce([1, 1, Date.now()]),
    });
    await expect(
      checkSreIncidentUpdateRateLimit("user-1", "inc-1"),
    ).resolves.toEqual({ allowed: true, remaining: 29 });
  });

  it("limits at 30 writes per minute per user and incident", async () => {
    const oldest = Date.now() - 1_000;
    const evalCommand = jest.fn().mockResolvedValueOnce([0, 30, oldest]);
    mockGetRedisConnection.mockResolvedValueOnce({ status: "ready", eval: evalCommand });

    const result = await checkSreIncidentUpdateRateLimit("user-1", "inc-1");

    expect(result.allowed).toBe(false);
    expect(result.resetTime).toBe(oldest + 60_000);
    expect(evalCommand.mock.calls[0][2]).toBe(
      "supercheck:sre:ratelimit:incident-update:user-1:inc-1",
    );
  });

  it("fails open and still logs when Redis is unavailable", async () => {
    mockGetRedisConnection.mockResolvedValueOnce(null);

    const result = await checkSreIncidentUpdateRateLimit("user-1", "inc-1");

    expect(result.allowed).toBe(true);
    expect(mockSreRateLimitLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "redis_unavailable" }),
      expect.any(String),
    );
  });
});
