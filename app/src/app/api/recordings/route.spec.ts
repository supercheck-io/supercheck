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
  });
});