/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    selectDistinct: jest.fn(),
  },
}));

jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  getUserOrgRole: jest.fn(),
}));

jest.mock("@/lib/logger/pino-config", () => {
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  };

  return {
    createLogger: () => logger,
    __logger: logger,
  };
});

import { GET } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    selectDistinct: jest.Mock;
  };
};

const {
  requireUserAuthContext: mockRequireUserAuthContext,
  isAuthError: mockIsAuthError,
} = jest.requireMock("@/lib/auth-context") as {
  requireUserAuthContext: jest.Mock;
  isAuthError: jest.Mock;
};

const { getUserOrgRole: mockGetUserOrgRole } = jest.requireMock(
  "@/lib/rbac/middleware",
) as {
  getUserOrgRole: jest.Mock;
};

describe("Audit API Route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAuthError.mockReturnValue(false);
    mockRequireUserAuthContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
    });
    mockGetUserOrgRole.mockResolvedValue("org_admin");
  });

  it("returns 403 when user role cannot view audit logs", async () => {
    mockGetUserOrgRole.mockResolvedValue("project_viewer");

    const request = new NextRequest("http://localhost/api/audit?page=1&limit=10");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Insufficient permissions");
  });

  it("clamps pagination inputs and returns normalized response data", async () => {
    const countQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([{ count: 250 }]),
    };

    const logsQuery = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockResolvedValue([
        {
          id: "audit-1",
          action: "login",
          details: { ip: "127.0.0.1" },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          userId: "user-1",
          userName: "Alice",
          userEmail: "alice@example.com",
        },
      ]),
    };

    const actionsQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockResolvedValue([
        { action: "login" },
        { action: null },
      ]),
    };

    mockDb.select
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(logsQuery);
    mockDb.selectDistinct.mockReturnValue(actionsQuery);

    const request = new NextRequest(
      `http://localhost/api/audit?page=-2&limit=999&sortOrder=invalid&search=${"x".repeat(
        400
      )}&action=${"y".repeat(200)}`
    );

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pagination.currentPage).toBe(1);
    expect(body.data.pagination.limit).toBe(100);
    expect(body.data.pagination.totalPages).toBe(3);
    expect(body.data.logs[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.data.filters.actions).toEqual(["login"]);
    expect(logsQuery.limit).toHaveBeenCalledWith(100);
    expect(logsQuery.offset).toHaveBeenCalledWith(0);
  });

  it("returns 401 for authentication failures without leaking internals", async () => {
    const authError = new Error("Authentication required");
    mockRequireUserAuthContext.mockRejectedValue(authError);
    mockIsAuthError.mockReturnValue(true);

    const request = new NextRequest("http://localhost/api/audit");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Authentication required");
  });
});
