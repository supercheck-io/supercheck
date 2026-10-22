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
});
