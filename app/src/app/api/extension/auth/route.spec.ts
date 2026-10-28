/** @jest-environment node */

import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

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
  isImpersonatedSession: jest.fn(async () => false),
}));

jest.mock("@/utils/db", () => {
  // Every apikey read ends in .orderBy(createdAt), which is awaited directly.
  let lookupRows: unknown[] = [];

  const limit = jest.fn(() => Promise.resolve([]));
  const orderBy = jest.fn(() => Object.assign(Promise.resolve(lookupRows), { limit }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));

  // db.transaction emulates pg_advisory_xact_lock: the first tx.execute waits for the
  // previous transaction to finish, and the lock is released when the callback ends.
  const update = jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => []) })) }));
  let lockTail: Promise<void> = Promise.resolve();
  const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const previous = lockTail;
    lockTail = mine;
    const tx = { select: jest.fn(() => ({ from })), update, execute: jest.fn(async () => { await previous; }) };
    try {
      return await callback(tx);
    } finally {
      release();
    }
  });

  return {
    db: { select: jest.fn(() => ({ from })), update, transaction },
    __where: where,
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
import { db } from "@/utils/db";

const { requireAuthContext: mockRequireAuthContext } = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
};
const { checkPermissionWithContext: mockCanCreateKey, isImpersonatedSession: mockImpersonated } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
  isImpersonatedSession: jest.Mock;
};

const { __setLookupRows, __where } = jest.requireMock("@/utils/db") as {
  __where: jest.Mock;
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
  it("allows a recorder to revoke only the key it holds without a session", async () => {
    const returning = jest.fn(async () => [{ id: 'extension-key' }]);
    const revokeWhere = jest.fn((_condition: SQL) => ({ returning }));
    jest.mocked(db.update).mockReturnValue({ set: () => ({ where: revokeWhere }) } as never);
    const response = await DELETE(new NextRequest('http://localhost/api/extension/auth', { method: 'DELETE', headers: { 'x-api-key': 'ext_test_credential' } }));
    expect(response.status).toBe(200);
    expect(mockAuth.api.getSession).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(revokeWhere.mock.calls[0][0]);
    expect(query.sql).toContain('"prefix"');
    expect(query.params).toContain('ext');
    expect(query.params).not.toContain('ext_test_credential');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    __setLookupRows([]);
    mockRequireAuthContext.mockResolvedValue({
      userId: "user-1", organizationId: "org-1", project: { id: "project-1", userRole: "project_editor" },
    });
    mockCanCreateKey.mockReturnValue(true);
    mockImpersonated.mockResolvedValue(false);
  });

  it("refuses to create a recorder key while impersonating a user", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mockImpersonated.mockResolvedValue(true);
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toMatch(/impersonating/);
    expect(mockAuth.api.createApiKey).not.toHaveBeenCalled();
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
    const query = new PgDialect().sqlToQuery(__where.mock.calls[0][0]);
    expect(query.params).toEqual(["user-1", "default", true]);
    expect(query.sql).not.toMatch(/"(?:prefix|name)"/);
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

  describe("key hand-off", () => {
    const session = { user: { id: "user-1", email: "user@example.com", name: "User One" } };
    const stored = (id: string, day: number) => ({
      id,
      name: "Recorder: Supercheck Recorder Ex",
      prefix: "ext",
      permissions: { recorder: ["save"] },
      createdAt: new Date(Date.UTC(2026, 0, day)),
    });
    const minted = { id: "key-new", key: "extNEWKEY", name: "n", prefix: "ext", enabled: true };

    beforeEach(() => {
      mockAuth.api.getSession.mockResolvedValue(session);
      mockAuth.api.createApiKey.mockResolvedValue(minted);
    });

    it.each([
      ["holds no key", null],
      ["holds a key the server no longer has", "key-gone"],
    ])("mints a new key when the extension %s", async (_label, clientKeyId) => {
      __setLookupRows([stored("key-old", 1)]);
      const body = await (await POST(postRequest({ clientKeyId }))).json();
      expect(body.data.apiKey).toBe("extNEWKEY");
      expect(mockAuth.api.createApiKey).toHaveBeenCalledTimes(1);
    });

    it("keeps the connection when the extension holds a live key, or is an older client that reports none", async () => {
      __setLookupRows([stored("key-old", 1)]);
      for (const payload of [{ clientKeyId: "key-old" }, {}]) {
        const body = await (await POST(postRequest(payload))).json();
        expect(body.data.message).toBe("Extension already connected");
        expect(body.data.keyId).toBe("key-old");
      }
      expect(mockAuth.api.createApiKey).not.toHaveBeenCalled();
    });

    it("disables the oldest keys beyond the per-user cap when minting", async () => {
      __setLookupRows([1, 2, 3, 4, 5].map((day) => stored(`key-${day}`, day)));
      await POST(postRequest({ clientKeyId: null }));
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it("serialises concurrent connects per user so only one key is minted", async () => {
      __setLookupRows([]);
      mockAuth.api.createApiKey.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        __setLookupRows([stored("key-new", 1)]);
        return minted;
      });
      const responses = await Promise.all([POST(postRequest({ clientKeyId: null })), POST(postRequest())]);
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(mockAuth.api.createApiKey).toHaveBeenCalledTimes(1);
      expect(bodies.filter((body) => body.data.apiKey)).toHaveLength(1);
    });
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

  it("revokes permission-only keys without restricting the lookup by name or prefix", async () => {
    mockAuth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mockAuth.api.updateApiKey.mockResolvedValue({});
    __setLookupRows([
      { id: "permission-only", name: "Custom recorder", prefix: "cli", permissions: '{"recorder":["save"]}' },
      { id: "ordinary-cli", name: "CLI", prefix: "cli", permissions: null },
    ]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/extension/auth", { method: "DELETE" })
    );

    expect((await response.json()).data.keysRevoked).toBe(1);
    expect(mockAuth.api.updateApiKey).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { configId: "default", keyId: "permission-only", enabled: false },
    });
    // Check the real predicate so fixtures cannot bypass SQL filtering.
    const query = new PgDialect().sqlToQuery(__where.mock.calls[0][0]);
    expect(query.params).toEqual(["user-1", "default", true]);
    expect(query.sql).not.toMatch(/"(?:prefix|name)"/);
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
