/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { GET } from "./route";

describe("GET /api/runs lists job runs only", () => {
  const wheres: SQL[] = [];
  const orderBys: unknown[][] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    wheres.length = 0;
    orderBys.length = 0;
    jest.mocked(requireAuthContext).mockResolvedValue({
      organizationId: "org-1",
      project: { id: "project-1" },
    } as never);
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
    // Chainable query builder; resolves to `rows` at the end of either query.
    jest.mocked(db.select).mockImplementation((() => {
      const query: Record<string, unknown> = {};
      for (const method of ["from", "leftJoin", "offset"]) {
        query[method] = jest.fn(() => query);
      }
      query.where = jest.fn((condition: SQL) => {
        wheres.push(condition);
        return query;
      });
      query.orderBy = jest.fn((...args: unknown[]) => {
        orderBys.push(args);
        return query;
      });
      query.limit = jest.fn(() => query);
      query.then = (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve([{ count: 0 }]).then(resolve);
      return query;
    }) as never);
  });

  it("scopes every query to the session's organization through the job, which excludes jobless playground runs", async () => {
    const response = await GET(new NextRequest("http://localhost/api/runs"));

    expect(response.status).toBe(200);
    expect(wheres).toHaveLength(2);
    for (const condition of wheres) {
      const { sql, params } = new PgDialect().sqlToQuery(condition);
      // jobs.organization_id = org: a run with job_id NULL never matches.
      expect(sql).toContain('"jobs"."organization_id" = $');
      expect(sql).toContain('"runs"."project_id" = $');
      expect(params).toEqual(expect.arrayContaining(["org-1", "project-1"]));
    }
  });

  it("rejects callers without permission before querying", async () => {
    jest.mocked(checkPermissionWithContext).mockReturnValue(false);
    const response = await GET(new NextRequest("http://localhost/api/runs"));
    expect(response.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("falls back to defaults for a non-numeric page or limit instead of a 500", async () => {
    const response = await GET(new NextRequest("http://localhost/api/runs?page=abc&limit=xyz"));
    expect(response.status).toBe(200);
    expect((await response.json()).pagination).toMatchObject({ page: 1, limit: 10 });
  });

  it("orders by start time with createdAt for queued runs, then id", async () => {
    await GET(new NextRequest("http://localhost/api/runs"));
    expect(orderBys).toHaveLength(1);
    const [byTime, byId] = orderBys[0] as SQL[];
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(byTime).sql).toMatch(/coalesce\("runs"\."started_at", "runs"\."created_at"\) desc/);
    expect(dialect.sqlToQuery(byId).sql).toContain('"runs"."id" desc');
  });

  describe("jobId filter", () => {
    it("answers 400 for a malformed id without querying, instead of a Postgres uuid error", async () => {
      const response = await GET(new NextRequest("http://localhost/api/runs?jobId=not-a-uuid"));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid jobId" });
      expect(db.select).not.toHaveBeenCalled();
    });

    it("treats an empty jobId like no filter", async () => {
      const response = await GET(new NextRequest("http://localhost/api/runs?jobId="));
      expect(response.status).toBe(200);
      for (const condition of wheres) {
        expect(new PgDialect().sqlToQuery(condition).sql).not.toContain('"runs"."job_id" = $');
      }
    });

    it("filters by a well-formed id", async () => {
      const jobId = "00000000-0000-4000-8000-0000000000b1";
      const response = await GET(new NextRequest(`http://localhost/api/runs?jobId=${jobId}`));
      expect(response.status).toBe(200);
      const { sql, params } = new PgDialect().sqlToQuery(wheres[0]);
      expect(sql).toContain('"runs"."job_id" = $');
      expect(params).toContain(jobId);
    });
  });
});
