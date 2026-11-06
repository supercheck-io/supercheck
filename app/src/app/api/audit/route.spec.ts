/** @jest-environment node */

import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    selectDistinct: jest.fn(),
  },
}));

jest.mock("@/lib/auth-context", () => ({
  authErrorStatus: (e: unknown) => ((e as { status?: number })?.status === 403 ? 403 : 401),
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
          userImage: "/api/users/user-1/avatar?v=abc",
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
    expect(body.data.logs[0].user).toEqual({ id: "user-1", name: "Alice", email: "alice@example.com", image: "/api/users/user-1/avatar?v=abc" });
    expect(body.data.filters.actions).toEqual(["login"]);
    expect(logsQuery.limit).toHaveBeenCalledWith(101);
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

  it("returns 403 when the AuthError is a permission denial", async () => {
    mockRequireUserAuthContext.mockRejectedValue(Object.assign(new Error("CLI access revoked"), { status: 403 }));
    mockIsAuthError.mockReturnValue(true);

    const response = await GET(new NextRequest("http://localhost/api/audit"));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("CLI access revoked");
  });

  it("escapes LIKE wildcards in search and orders by an id tiebreaker", async () => {
    const countQuery = { from: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue([{ count: 0 }]) };
    const logsQuery = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockResolvedValue([]),
    };
    mockDb.select.mockReturnValueOnce(countQuery).mockReturnValueOnce(logsQuery);
    mockDb.selectDistinct.mockReturnValue({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockResolvedValue([]) });

    await GET(new NextRequest("http://localhost/api/audit?search=" + encodeURIComponent("50%_a\\b")));

    const { params } = new PgDialect().sqlToQuery(countQuery.where.mock.calls[0][0]);
    expect(params).toContain("%50\\%\\_a\\\\b%");
    expect(logsQuery.orderBy.mock.calls[0]).toHaveLength(2);
  });

  describe("keyset cursor", () => {
    const cursorOf = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`).toString("base64url");
    const ID1 = "0196a1b2-0000-7000-8000-000000000001";
    const ID2 = "0196a1b2-0000-7000-8000-000000000002";
    const ID3 = "0196a1b2-0000-7000-8000-000000000003";

    function setup(rows: unknown[]) {
      const countQuery = { from: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue([{ count: 3 }]) };
      const logsQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(rows),
      };
      mockDb.select.mockReturnValueOnce(countQuery).mockReturnValueOnce(logsQuery);
      mockDb.selectDistinct.mockReturnValue({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockResolvedValue([]) });
      return { countQuery, logsQuery };
    }
    const row = (id: string, createdAtCursor: string) => ({
      id, action: "login", details: null, createdAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: null, userName: null, userEmail: null, userImage: null, createdAtCursor,
    });

    it("returns nextCursor from the last row only when another row follows", async () => {
      setup([row(ID3, "2026-01-01 00:00:00.000003+00"), row(ID2, "2026-01-01 00:00:00.000002+00"), row(ID1, "2026-01-01 00:00:00.000001+00")]);
      const body = await (await GET(new NextRequest("http://localhost/api/audit?limit=2"))).json();

      expect(body.data.logs.map((l: { id: string }) => l.id)).toEqual([ID3, ID2]);
      expect(body.data.organizationId).toBe("org-1");
      expect(body.data.pagination.nextCursor).toBe(cursorOf("2026-01-01 00:00:00.000002+00", ID2));
    });

    it("has no nextCursor on the last page", async () => {
      setup([row(ID1, "2026-01-01 00:00:00.000001+00")]);
      const body = await (await GET(new NextRequest("http://localhost/api/audit?limit=2"))).json();

      expect(body.data.pagination.nextCursor).toBeNull();
    });

    it("applies the cursor to the log query only, not the count, and ignores page offsets", async () => {
      const { countQuery, logsQuery } = setup([]);
      const cursor = cursorOf("2026-01-01 00:00:00.000002+00", ID2);
      await GET(new NextRequest(`http://localhost/api/audit?page=5&limit=2&cursor=${cursor}`));

      const logSql = new PgDialect().sqlToQuery(logsQuery.where.mock.calls[0][0]);
      expect(logSql.params).toEqual(expect.arrayContaining(["2026-01-01 00:00:00.000002+00", ID2]));
      expect(logSql.sql).toContain("<");
      const countSql = new PgDialect().sqlToQuery(countQuery.where.mock.calls[0][0]);
      expect(countSql.params).not.toContain(ID2);
      expect(logsQuery.offset).toHaveBeenCalledWith(0);
    });

    it("reports only cursor-relevant pagination fields in cursor mode", async () => {
      setup([row(ID1, "2026-01-01 00:00:00.000001+00")]);
      const cursor = cursorOf("2026-01-01 00:00:00.000002+00", ID2);
      const body = await (await GET(new NextRequest(`http://localhost/api/audit?limit=2&cursor=${cursor}`))).json();

      expect(body.data.pagination).toEqual({ totalCount: 3, limit: 2, hasNext: false, nextCursor: null });
    });

    it("uses > for ascending order", async () => {
      const { logsQuery } = setup([]);
      const cursor = cursorOf("2026-01-01 00:00:00.000002+00", ID2);
      await GET(new NextRequest(`http://localhost/api/audit?sortOrder=asc&cursor=${cursor}`));

      expect(new PgDialect().sqlToQuery(logsQuery.where.mock.calls[0][0]).sql).toContain(">");
    });

    it.each(["not-a-cursor", cursorOf("2026-02-31 00:00:00+00", ID2), cursorOf("2026-01-01 24:00:00+00", ID2), cursorOf("2026-01-01",ID2), cursorOf("2026-01-01 00:00:00+00", "x"), cursorOf("2026-01-01 00:00:00+00", `${ID2}|extra`)])(
      "rejects the malformed cursor %s with 400",
      async (cursor) => {
        const response = await GET(new NextRequest(`http://localhost/api/audit?cursor=${cursor}`));

        expect(response.status).toBe(400);
        expect(mockDb.select).not.toHaveBeenCalled();
      },
    );
  });
});
