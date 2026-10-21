/** @jest-environment node */
const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock("@/utils/db", () => ({
  db: jest.requireActual("drizzle-orm/pg-proxy").drizzle(
    (...args: unknown[]) => mockQuery(...args),
  ),
}));
const mockContext = { userId: "user-1", organizationId: "org-1", project: { id: "project-1" } };
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => mockContext) }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(async () => mockContext), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
import { NextRequest } from "next/server";
import { getRequirements } from "@/actions/requirements";
import { GET } from "@/app/api/requirements/route";

describe.each(["action", "API"])("requirement coverage pagination via %s", (entry) => {
  beforeEach(() => { mockQuery.mockClear(); });
  it.each(["missing", "covered", "partial", "failing"] as const)(
    "filters %s coverage in both the page and count SQL",
    async (status) => {
      if (entry === "action") await getRequirements({ page: 2, pageSize: 1, status });
      else {
        const response = await GET(new NextRequest(`http://localhost/api/requirements?page=2&pageSize=1&status=${status}`));
        expect(response.status).toBe(200);
      }
      const queries = mockQuery.mock.calls as [string, unknown[]][];
      expect(queries).toHaveLength(2);
      for (const [query, params] of queries) {
        expect(query).toContain('left join "requirement_coverage_snapshots"');
        expect(query).toMatch(/where.*coalesce\("requirement_coverage_snapshots"\."status", 'missing'\) = \$/);
        expect(params).toEqual(expect.arrayContaining(["project-1", status]));
      }
      const pageQuery = queries.find(([query]) => !query.includes("count(*)"))!;
      expect(pageQuery[0]).toMatch(/where.*coalesce.*limit \$\d+ offset \$\d+/);
      expect(pageQuery[1].slice(-2)).toEqual([1, 1]);
    },
  );
});
