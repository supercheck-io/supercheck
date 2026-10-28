/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
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
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
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

import { PgDialect } from "drizzle-orm/pg-core";
import { encodeStoredTestScript } from "@/lib/test-script";
import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    insert: jest.Mock;
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
      innerJoin: jest.fn().mockReturnThis(),
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
      innerJoin: jest.fn().mockReturnThis(),
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
      innerJoin: jest.fn().mockReturnThis(),
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
    expect(mockDefaultKeyHasher).toHaveBeenCalledWith(
      "extABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    );
  });

  it("accepts Better Auth permission objects for recorder uploads", async () => {
    const keyQuery = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
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
      innerJoin: jest.fn().mockReturnThis(),
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
  it("rejects a recorder key while its owner is banned", async () => {
    const query = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "key",
          userId: "user-1",
          banned: true,
          banExpires: null,
          prefix: "ext",
        },
      ]),
    };
    mockDb.select.mockReturnValueOnce(query);
    const response = await POST(
      new NextRequest("http://localhost/api/recordings", {
        method: "POST",
        headers: { "X-API-Key": "ext-test" },
      }),
    );
    expect(response.status).toBe(401);
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("checks the resolved project permission context before saving a recording", async () => {
    const rows = (result: unknown[]) => ({
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(result),
    });
    mockDb.select
      .mockReturnValueOnce(
        rows([
          {
            id: "key",
            userId: "user-1",
            prefix: "ext",
            banned: false,
            banExpires: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        rows([
          { id: "11111111-1111-4111-8111-111111111111", organizationId: "org" },
        ]),
      );
    const { resolveProjectPermissionContext, checkPermissionWithContext } =
      jest.requireMock("@/lib/rbac/middleware");
    const context = {
      userId: "user-1",
      organizationId: "org",
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        userRole: "project_viewer",
      },
    };
    resolveProjectPermissionContext.mockResolvedValueOnce(context);
    checkPermissionWithContext.mockReturnValueOnce(false);
    const response = await POST(
      new NextRequest("http://localhost/api/recordings", {
        method: "POST",
        headers: {
          "X-API-Key": "ext-test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: context.project.id,
          name: "Recording",
          script: "console.log('hello')",
          metadata: {
            recordedAt: "2026-10-21",
            duration: 0,
            stepsCount: 0,
            baseUrl: "https://example.com",
          },
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(resolveProjectPermissionContext).toHaveBeenCalledWith(
      "user-1",
      context.project.id,
    );
    expect(checkPermissionWithContext).toHaveBeenCalledWith(
      "test",
      "create",
      context,
    );
  });

  describe("with an authorised recorder key", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const rows = (result: unknown[]) => ({
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(result),
    });
    const post = (script: string) => POST(
      new NextRequest("http://localhost/api/recordings", {
        method: "POST",
        headers: { "X-API-Key": "ext-test", "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: "Recording",
          script,
          metadata: { recordedAt: new Date().toISOString(), duration: 1, stepsCount: 1, baseUrl: "https://example.com" },
        }),
      }),
    );
    let projectQuery: ReturnType<typeof rows>;

    beforeEach(() => {
      projectQuery = rows([{ id: projectId, name: "P", organizationId: "org" }]);
      mockDb.select
        .mockReturnValueOnce(rows([{ id: "key", userId: "user-1", prefix: "ext", banned: false, banExpires: null }]))
        .mockReturnValueOnce(projectQuery);
      const { resolveProjectPermissionContext, checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware");
      resolveProjectPermissionContext.mockResolvedValueOnce({ userId: "user-1", organizationId: "org", project: { id: projectId, userRole: "project_editor" } });
      checkPermissionWithContext.mockReturnValueOnce(true);
    });

    it("only saves into active projects", async () => {
      const values = jest.fn(() => ({ returning: async () => [{ id: "test-1" }] }));
      mockDb.insert.mockReturnValue({ values });
      const response = await post("import { test } from '@playwright/test';");
      expect(response.status).toBe(201);
      const query = new PgDialect().sqlToQuery(projectQuery.where.mock.calls[0][0]);
      expect(query.sql).toContain('"status"');
      expect(query.params).toContain("active");
    });

    it("returns 404 and saves nothing when the project is not active", async () => {
      projectQuery.limit.mockResolvedValue([]);
      const response = await post("import { test } from '@playwright/test';");
      expect(response.status).toBe(404);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("rejects a script that is empty once normalised", async () => {
      const response = await post("\u0000");
      expect(response.status).toBe(400);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("rejects a k6 script posted as a browser recording", async () => {
      const response = await post("import http from 'k6/http'; export default function () { http.get('https://example.com'); }");
      expect(response.status).toBe(400);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("stores the script sanitised and encoded like a normal test", async () => {
      const values = jest.fn(() => ({ returning: async () => [{ id: "test-1" }] }));
      mockDb.insert.mockReturnValue({ values });
      const response = await post("import { test } from '@playwright/test';\u0000");
      expect(response.status).toBe(201);
      const stored = (values.mock.calls[0] as unknown as [{ script: string }])[0].script;
      expect(stored).toBe(encodeStoredTestScript("import { test } from '@playwright/test';"));
    });
  });
});
