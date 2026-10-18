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
  // The route reaches the apikey table two ways:
  //   POST's fast path  -> .orderBy(createdAt).limit(1)
  //   the shared lookup -> .orderBy(createdAt)   (awaited directly)
  // so the value orderBy returns has to be awaitable and also carry limit().
  let persistedRows: unknown[] = [];
  let lookupRows: unknown[] = [];

  const limit = jest.fn(() => Promise.resolve(persistedRows));
  const orderBy = jest.fn(() => Object.assign(Promise.resolve(lookupRows), { limit }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));

  return {
    db: { select: jest.fn(() => ({ from })) },
    __setPersistedRows: (rows: unknown[]) => {
      persistedRows = rows;
    },
    __setLookupRows: (rows: unknown[]) => {
      lookupRows = rows;
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

import { DELETE, POST } from "./route";

const { requireAuthContext: mockRequireAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
};
const { checkPermissionWithContext: mockCanCreateKey } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
};

const { __setPersistedRows, __setLookupRows } = jest.requireMock("@/utils/db") as {
  __setPersistedRows: (rows: unknown[]) => void;
  __setLookupRows: (rows: unknown[]) => void;
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

const extensionKey = (id: string, createdAt: Date) => ({
  id,
  name: "Recorder: Supercheck Recorder Ex",
  prefix: "ext",
  permissions: { recorder: ["save"] },
  createdAt,
});

const postRequest = (body: Record<string, unknown> = {}) =>
  new NextRequest("http://localhost/api/extension/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Extension auth route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __setPersistedRows([]);
    __setLookupRows([]);
    mockRequireAuthContext.mockResolvedValue({
      userId: "user-1", organizationId: "org-1", project: { id: "project-1", userRole: "project_editor" },
    });
    mockCanCreateKey.mockReturnValue(true);
  });

  it("forbids a viewer from creating a recorder API key", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "viewer-1" } });
    mockCanCreateKey.mockReturnValue(false);
    const response = await POST(postRequest());
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

    // No key matches by prefix or name, so this exercises the shared lookup.
    __setPersistedRows([]);
    __setLookupRows([
      {
        id: "key-1",
        name: "Something else",
        prefix: "cli",
        permissions: { recorder: ["save"] },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const response = await POST(postRequest({ name: "Recorder: Supercheck Recorder Ex" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("Extension already connected");
    expect(body.data.keyId).toBe("key-1");
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

    __setPersistedRows([]);
    __setLookupRows([
      {
        id: "key-legacy",
        name: "Extension Helper",
        prefix: "cli",
        permissions: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    mockAuth.api.createApiKey.mockResolvedValue({
      id: "key-2",
      key: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const response = await POST(postRequest({ name: "Recorder: Supercheck Recorder Ex" }));
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

    __setPersistedRows([]);
    __setLookupRows([]);

    mockAuth.api.createApiKey.mockResolvedValue({
      id: "key-2",
      key: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const response = await POST(postRequest({ name: "Supercheck Recorder Extension" }));
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

    __setPersistedRows([]);
    __setLookupRows([]);

    mockAuth.api.createApiKey.mockResolvedValue({
      id: "key-2",
      key: "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      name: "Supercheck Recorder Extension",
      prefix: "ext",
      enabled: true,
    });

    const response = await POST(
      postRequest({ name: "Supercheck Recorder Extension With Extra Debug Suffix" })
    );

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

    __setPersistedRows([]);
    __setLookupRows([]);

    const error = Object.assign(new Error("server-only property"), {
      status: "BAD_REQUEST",
      statusCode: 400,
      body: { message: "Server-only property" },
    });
    mockAuth.api.createApiKey.mockRejectedValue(error);

    const response = await POST(postRequest({ name: "Supercheck Recorder Extension" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Server-only property");
  });

  it("revokes every enabled extension key", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAuth.api.updateApiKey.mockResolvedValue({});

    __setLookupRows([
      extensionKey("key-1", new Date("2026-01-01T00:00:00Z")),
      extensionKey("key-2", new Date("2026-01-02T00:00:00Z")),
    ]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", { method: "DELETE" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.keysRevoked).toBe(2);
    expect(mockAuth.api.updateApiKey).toHaveBeenCalledTimes(2);
  });

  it("revokes the newest key when the account holds more than 100 API keys", async () => {
    // Regression: the lookup used to page through listApiKeys, whose adapter caps
    // unpaginated reads at 100 rows, so a newer extension key was invisible and
    // revocation silently did nothing.
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAuth.api.updateApiKey.mockResolvedValue({});

    const filler = Array.from({ length: 150 }, (_, index) => ({
      id: `cli-${index}`,
      name: `CLI key ${index}`,
      prefix: "cli",
      permissions: null,
      createdAt: new Date(2026, 0, 1, 0, index),
    }));
    const newest = extensionKey("ext-newest", new Date("2026-06-01T00:00:00Z"));
    __setLookupRows([...filler, newest]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", { method: "DELETE" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.keysRevoked).toBe(1);
    expect(mockAuth.api.listApiKeys).not.toHaveBeenCalled();
    expect(mockAuth.api.updateApiKey).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        configId: "default",
        keyId: "ext-newest",
        enabled: false,
      },
    });
  });

  it("reports zero revocations when there is no extension key", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
    __setLookupRows([]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", { method: "DELETE" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.keysRevoked).toBe(0);
    expect(mockAuth.api.updateApiKey).not.toHaveBeenCalled();
  });
});
