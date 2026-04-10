/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
      listApiKeys: jest.fn(),
      createApiKey: jest.fn(),
      updateApiKey: jest.fn(),
    },
  },
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers()),
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

const { auth: mockAuth } = jest.requireMock("@/utils/auth") as {
  auth: {
    api: {
      getSession: jest.Mock;
      listApiKeys: jest.Mock;
      createApiKey: jest.Mock;
      updateApiKey: jest.Mock;
    };
  };
};

describe("Extension auth route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns success when the extension is already connected", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });

    mockAuth.api.listApiKeys.mockResolvedValue({
      apiKeys: [
        {
          id: "key-1",
          name: "SuperCheck Recorder Extension",
          prefix: "ext",
          enabled: true,
        },
      ],
      total: 1,
      limit: undefined,
      offset: undefined,
    });

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
    expect(body.data.message).toBe("Extension already connected");
    expect(mockAuth.api.listApiKeys).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: {
        configId: "default",
        limit: 1000,
      },
    });
    expect(mockAuth.api.createApiKey).not.toHaveBeenCalled();
  });

  it("does not treat non-extension keys with similar names as the recorder integration", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });

    mockAuth.api.listApiKeys.mockResolvedValue({
      apiKeys: [
        {
          id: "key-legacy",
          name: "Extension Helper",
          prefix: "cli",
          enabled: true,
          permissions: null,
        },
      ],
      total: 1,
      limit: undefined,
      offset: undefined,
    });

    mockAuth.api.createApiKey.mockResolvedValue({
      id: "key-2",
      key: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      name: "SuperCheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

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
    expect(body.data.apiKey).toBe("extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(mockAuth.api.createApiKey).toHaveBeenCalledTimes(1);
  });

  it("creates a new extension API key through Better Auth when none exists", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });

    mockAuth.api.listApiKeys.mockResolvedValue({
      apiKeys: [],
      total: 0,
      limit: undefined,
      offset: undefined,
    });

    mockAuth.api.createApiKey.mockResolvedValue({
      id: "key-2",
      key: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      name: "SuperCheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

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
    expect(body.data.apiKey).toBe("extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(mockAuth.api.createApiKey).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        configId: "default",
        name: "SuperCheck Recorder Extension",
        prefix: "ext",
        permissions: {
          recorder: ["save"],
        },
      },
    });
  });
});
