/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("@/utils/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock("@/lib/security/api-key-hash", () => ({
  generateApiKey: jest.fn(() => "sck_trigger_1234567890abcdef1234567890abcdef"),
  hashApiKey: jest.fn(() => "hashed-extension-key"),
  getApiKeyPrefix: jest.fn(() => "sck_trigger_1234..."),
}));

jest.mock("@/lib/logger/pino-config", () => {
  const logger = {
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
    insert: jest.Mock;
  };
};

const { auth: mockAuth } = jest.requireMock("@/utils/auth") as {
  auth: {
    api: {
      getSession: jest.Mock;
    };
  };
};

describe("Extension auth route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates extension API keys with an explicit id", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });

    const existingKeysQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };

    const returning = jest.fn().mockResolvedValue([{ id: "key-1" }]);
    const values = jest.fn().mockReturnValue({ returning });

    mockDb.select.mockReturnValue(existingKeysQuery);
    mockDb.insert.mockReturnValue({ values });

    const request = new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "SuperCheck Recorder Extension",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.apiKey).toBe("sck_trigger_1234567890abcdef1234567890abcdef");
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        referenceId: "user-1",
        prefix: "ext",
        key: "hashed-extension-key",
        permissions: ["recorder:save"],
      })
    );
  });
});
