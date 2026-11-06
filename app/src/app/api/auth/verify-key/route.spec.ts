/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(),
}));

jest.mock("@/lib/security/api-key-hash", () => ({
  hashApiKey: jest.fn(() => "legacy-hash"),
}));

jest.mock("@better-auth/api-key", () => ({
  defaultKeyHasher: jest.fn(async () => "plugin-hash"),
}));

jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    update: jest.Mock;
  };
};

const { getRedisConnection: mockGetRedisConnection } = jest.requireMock(
  "@/lib/queue",
) as {
  getRedisConnection: jest.Mock;
};

const { hashApiKey: mockHashApiKey } = jest.requireMock(
  "@/lib/security/api-key-hash",
) as {
  hashApiKey: jest.Mock;
};

const { defaultKeyHasher: mockDefaultKeyHasher } = jest.requireMock(
  "@better-auth/api-key",
) as {
  defaultKeyHasher: jest.Mock;
};

function createRedisMock() {
  const multi = {
    zremrangebyscore: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    zrange: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      [null, 0],
      [null, 0],
      [null, []],
    ]),
  };

  return {
    multi: jest.fn(() => multi),
    zadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
}

describe("verify-key route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRedisConnection.mockResolvedValue(createRedisMock());
  });

  it.each([
    [false, null, 200],
    [true, null, 401],
    [true, new Date(Date.now() + 3600000), 401],
    [true, new Date(0), 200],
  ])("checks the owner ban for hashed keys (banned=%s, expires=%s)", async (banned, banExpires, status) => {
    const selectQuery = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "key-1",
          banned,
          banExpires,
          key: "plugin-hash",
          enabled: true,
          expiresAt: null,
          jobId: "job-1",
          userId: "user-1",
          name: "Recorder Extension",
        },
      ]),
    };

    const updateQuery = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };

    mockDb.select.mockReturnValue(selectQuery);
    mockDb.update.mockReturnValue(updateQuery);

    const request = new NextRequest("http://localhost/api/auth/verify-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        jobId: "job-1",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(status);
    if (status === 401) {
      expect(body.error).toBeDefined();
      expect(mockDb.update).not.toHaveBeenCalled();
      return;
    }
    expect(body).toEqual({
      valid: true,
      keyId: "key-1",
      jobId: "job-1",
    });
    expect(mockHashApiKey).toHaveBeenCalledWith(
      "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    );
    expect(mockDefaultKeyHasher).toHaveBeenCalledWith(
      "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    );
  });

  describe("rate limit key", () => {
    const post = (headers: Record<string, string>) => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });
      return POST(new NextRequest("http://localhost/api/auth/verify-key", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ apiKey: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", jobId: "job-1" }),
      }));
    };

    it("keys on the proxy-appended X-Forwarded-For entry, not the client-supplied first one", async () => {
      const redis = createRedisMock();
      mockGetRedisConnection.mockResolvedValue(redis);
      await post({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
      expect(redis.zadd).toHaveBeenCalledWith("supercheck:verify-key:ratelimit:2.2.2.2", expect.any(Number), expect.any(String));
    });

    it("uses a shared high-ceiling bucket when no trusted client IP is present", async () => {
      const redis = createRedisMock();
      redis.multi().exec.mockResolvedValue([[null, 0], [null, 10], [null, []]]);
      mockGetRedisConnection.mockResolvedValue(redis);
      const response = await post({});
      expect(response.status).not.toBe(429);
      expect(redis.zadd).toHaveBeenCalledWith("supercheck:verify-key:ratelimit:unknown", expect.any(Number), expect.any(String));
    });
  });

  it("reports the applied limit on 429 for requests without a trusted IP", async () => {
    const redis = createRedisMock();
    redis.multi().exec.mockResolvedValue([[null, 0], [null, 300], [null, []]]);
    mockGetRedisConnection.mockResolvedValue(redis);
    const response = await POST(new NextRequest("http://localhost/api/auth/verify-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", jobId: "job-1" }),
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("300");
  });

  describe("when the rate limiter backend is unavailable", () => {
    const call = () => POST(new NextRequest("http://localhost/api/auth/verify-key", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
      body: JSON.stringify({ apiKey: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", jobId: "job-1" }),
    }));

    it.each([
      ["Redis is not configured", () => mockGetRedisConnection.mockResolvedValue(null)],
      ["Redis throws", () => mockGetRedisConnection.mockRejectedValue(new Error("down"))],
      ["the transaction fails", () => {
        const redis = createRedisMock();
        redis.multi().exec.mockResolvedValue(null);
        mockGetRedisConnection.mockResolvedValue(redis);
      }],
    ])("fails closed with 503 and Retry-After when %s", async (_label, breakRedis) => {
      breakRedis();
      const response = await call();
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("30");
    });

    it("fails closed when a Redis command never resolves, and when Redis is not ready", async () => {
      jest.useFakeTimers();
      try {
        const redis = createRedisMock();
        redis.multi().exec.mockReturnValue(new Promise(() => {}));
        mockGetRedisConnection.mockResolvedValue({ ...redis, status: "ready" });
        const pending = call();
        await jest.advanceTimersByTimeAsync(2000);
        expect((await pending).status).toBe(503);
      } finally {
        jest.useRealTimers();
      }
      const redis = createRedisMock();
      mockGetRedisConnection.mockResolvedValue({ ...redis, status: "connecting" });
      expect((await call()).status).toBe(503);
      expect(redis.multi).not.toHaveBeenCalled();
    });

    it("limits and allows normally while Redis is up", async () => {
      const redis = createRedisMock();
      mockGetRedisConnection.mockResolvedValue(redis);
      expect((await call()).status).not.toBe(503);
      redis.multi().exec.mockResolvedValue([[null, 0], [null, 10], [null, []]]);
      expect((await call()).status).toBe(429);
    });
  });
});
