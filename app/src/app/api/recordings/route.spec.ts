/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    blockUntilSubscribed: jest.fn(),
    requireValidPolarCustomer: jest.fn(),
  },
}));

jest.mock("@/lib/rbac/middleware", () => ({
  getUserRole: jest.fn(),
  getUserAssignedProjects: jest.fn(),
}));

jest.mock("@/lib/rbac/permissions", () => ({
  hasPermission: jest.fn(),
}));

jest.mock("@/lib/security/api-key-hash", () => ({
  hashApiKey: jest.fn(() => "hashed-key"),
}));

jest.mock("@better-auth/api-key", () => ({
  defaultKeyHasher: jest.fn(async () => "better-auth-hash"),
}));

jest.mock("@/lib/logger/pino-config", () => {
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };

  return {
    createLogger: () => logger,
    __logger: logger,
  };
});

import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
  };
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

describe("Recordings API Route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects non-recorder API keys before processing uploads", async () => {
    const keyQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "key-1",
          key: "hashed-key",
          userId: "user-1",
          enabled: true,
          expiresAt: null,
          permissions: ["cli:full"],
          prefix: "cli",
        },
      ]),
    };

    mockDb.select.mockReturnValueOnce(keyQuery);

    const request = new NextRequest("http://localhost/api/recordings", {
      method: "POST",
      headers: {
        "X-API-Key": "sck_live_1234567890",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe("API key is not authorized for recorder uploads");
    expect(mockHashApiKey).toHaveBeenCalledWith("sck_live_1234567890");
    expect(mockDefaultKeyHasher).toHaveBeenCalledWith("sck_live_1234567890");
  });

  it("accepts Better Auth hashed extension keys and continues past authentication", async () => {
    const keyQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "key-2",
          key: "better-auth-hash",
          userId: "user-1",
          enabled: true,
          expiresAt: null,
          permissions: null,
          prefix: "ext",
        },
      ]),
    };

    const projectQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    mockDb.select
      .mockReturnValueOnce(keyQuery)
      .mockReturnValueOnce(projectQuery);

    const request = new NextRequest("http://localhost/api/recordings", {
      method: "POST",
      headers: {
        "X-API-Key": "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "11111111-1111-4111-8111-111111111111",
        name: "Recorded flow",
        script: "console.log('hello')",
        metadata: {
          recordedAt: new Date().toISOString(),
          duration: 1000,
          stepsCount: 3,
          baseUrl: "https://example.com",
          extensionVersion: "1.0.0",
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Project not found");
    expect(mockDefaultKeyHasher).toHaveBeenCalledWith("extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  });

  it("accepts Better Auth permission objects for recorder uploads", async () => {
    const keyQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "key-3",
          key: "better-auth-hash",
          userId: "user-1",
          enabled: true,
          expiresAt: null,
          permissions: { recorder: ["save"] },
          prefix: "cli",
        },
      ]),
    };

    const projectQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    mockDb.select
      .mockReturnValueOnce(keyQuery)
      .mockReturnValueOnce(projectQuery);

    const request = new NextRequest("http://localhost/api/recordings", {
      method: "POST",
      headers: {
        "X-API-Key": "sck_live_1234567890",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "11111111-1111-4111-8111-111111111111",
        name: "Recorded flow",
        script: "console.log('hello')",
        metadata: {
          recordedAt: new Date().toISOString(),
          duration: 1000,
          stepsCount: 3,
          baseUrl: "https://example.com",
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Project not found");
  });
});
