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

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/utils/db", () => {
  const limit = jest.fn(() => Promise.resolve([]));
  let revokeRows: unknown[] = [];
  // POST awaits .orderBy(createdAt).limit(1); DELETE awaits .orderBy(createdAt).
  const orderBy = jest.fn(() => {
    const rows = Promise.resolve(revokeRows);
    return Object.assign(rows, { limit });
  });
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));

  return {
    db: { select: jest.fn(() => ({ from })) },
    __mockLimit: limit,
    __mockRevokeRows: (rows: unknown[]) => {
      revokeRows = rows;
    },
  };
});

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

import { POST, DELETE } from "./route";

const { requireAuthContext: mockRequireAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
};
const { checkPermissionWithContext: mockCanCreateKey } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
};

const {
  __mockLimit: mockPersistedKeyLookup,
  __mockRevokeRows: mockRevokeRows,
} = jest.requireMock("@/utils/db") as {
  __mockLimit: jest.Mock;
  __mockRevokeRows: (rows: Array<{ id: string }>) => void;
};

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
    mockPersistedKeyLookup.mockResolvedValue([]);
    mockRevokeRows([]);
    mockRequireAuthContext.mockResolvedValue({
      userId: "user-1", organizationId: "org-1", project: { id: "project-1", userRole: "project_editor" },
    });
    mockCanCreateKey.mockReturnValue(true);
  });

  it("forbids a viewer from creating a recorder API key", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "viewer-1" } });
    mockCanCreateKey.mockReturnValue(false);
    const response = await POST(new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    expect(response.status).toBe(403);
    expect(mockAuth.api.createApiKey).not.toHaveBeenCalled();
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
          name: "Supercheck Recorder Extension",
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
        name: "Recorder: Supercheck Recorder Ex",
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
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const request = new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Recorder: Supercheck Recorder Ex",
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
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const request = new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Supercheck Recorder Extension",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.apiKey).toBe("extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(mockAuth.api.createApiKey).toHaveBeenCalledWith({
      body: {
        userId: "user-1",
        configId: "default",
        name: "Recorder: Supercheck Recorder Ex",
        prefix: "ext",
        permissions: {
          recorder: ["save"],
        },
      },
    });
  });

  it("normalizes extension key names to Better Auth limits before creation", async () => {
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
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const request = new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Supercheck Recorder Extension With Extra Debug Suffix",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockAuth.api.createApiKey).toHaveBeenCalledWith({
      body: expect.objectContaining({
        userId: "user-1",
        name: "Recorder: Supercheck Recorder Ex",
      }),
    });
  });

  it("returns Better Auth validation failures without converting them to 500s", async () => {
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

    const error = Object.assign(new Error("server-only property"), {
      status: "BAD_REQUEST",
      statusCode: 400,
      body: { message: "Server-only property" },
    });
    mockAuth.api.createApiKey.mockRejectedValue(error);

    const request = new NextRequest("http://localhost/api/extension/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Supercheck Recorder Extension",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Server-only property");
  });

  it("revokes enabled extension keys without relying on the capped list endpoint", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });
    // A user with more than 100 API keys no longer appears in full through
    // Better Auth's list endpoint, so revocation must resolve keys directly.
    mockRevokeRows([{ id: "key-100" }, { id: "key-101" }]);
    mockAuth.api.updateApiKey.mockResolvedValue({ id: "key-100" });

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", {
        method: "DELETE",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { keysRevoked: 2 } });
    expect(mockAuth.api.listApiKeys).not.toHaveBeenCalled();
    expect(mockAuth.api.updateApiKey).toHaveBeenCalledTimes(2);
    expect(mockAuth.api.updateApiKey).toHaveBeenNthCalledWith(1, {
      headers: expect.any(Headers),
      body: { configId: "default", keyId: "key-100", enabled: false },
    });
    expect(mockAuth.api.updateApiKey).toHaveBeenNthCalledWith(2, {
      headers: expect.any(Headers),
      body: { configId: "default", keyId: "key-101", enabled: false },
    });
  });

  it("reports zero revocations when no enabled extension key exists", async () => {
    mockAuth.api.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User One",
      },
    });
    mockRevokeRows([]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { keysRevoked: 0 },
    });
    expect(mockAuth.api.updateApiKey).not.toHaveBeenCalled();
  });

  it("requires a session before revoking extension keys", async () => {
    mockAuth.api.getSession.mockResolvedValue(null);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockAuth.api.updateApiKey).not.toHaveBeenCalled();
  });
});
