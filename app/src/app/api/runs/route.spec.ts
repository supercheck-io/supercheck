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

  beforeEach(() => {
    jest.clearAllMocks();
    wheres.length = 0;
    jest.mocked(requireAuthContext).mockResolvedValue({
      organizationId: "org-1",
      project: { id: "project-1" },
    } as never);
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
    // Chainable query builder; resolves to `rows` at the end of either query.
    jest.mocked(db.select).mockImplementation((() => {
      const query: Record<string, unknown> = {};
      for (const method of ["from", "leftJoin", "orderBy", "offset"]) {
        query[method] = jest.fn(() => query);
      }
      query.where = jest.fn((condition: SQL) => {
        wheres.push(condition);
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
});
