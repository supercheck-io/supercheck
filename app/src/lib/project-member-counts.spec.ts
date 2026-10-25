/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getProjectMemberCounts } from "./project-member-counts";

const results: unknown[][] = [];
const calls: Array<Record<string, unknown[]>> = [];
const chain = () => {
  const c: Record<string, unknown> = {};
  const seen: Record<string, unknown[]> = {};
  calls.push(seen);
  for (const m of ["from", "innerJoin", "leftJoin", "where"])
    c[m] = (...args: unknown[]) => { (seen[m] ??= []).push(...args); return c; };
  c.groupBy = () => Promise.resolve(results.shift());
  return c;
};
const toSql = (condition: unknown) => new PgDialect().sqlToQuery(condition as SQL);
const select = jest.fn(() => chain());
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => (select as jest.Mock)(...a) } }));

beforeEach(() => { select.mockClear(); results.length = 0; calls.length = 0; });

it("adds org owners/admins to explicit members using two grouped queries", async () => {
  results.push([{ projectId: "p1", total: 2 }], [{ organizationId: "o1", total: 3 }]);
  const counts = await getProjectMemberCounts([
    { id: "p1", organizationId: "o1" },
    { id: "p2", organizationId: "o1" },
  ]);
  expect(counts.get("p1")).toBe(5);
  expect(counts.get("p2")).toBe(3);
  expect(select).toHaveBeenCalledTimes(2);
});

it("skips the database for an empty project list", async () => {
  expect((await getProjectMemberCounts([])).size).toBe(0);
  expect(select).not.toHaveBeenCalled();
});

it("excludes org-wide admins from explicit members, requires current org membership, and counts admins per org", async () => {
  results.push([], []);
  await getProjectMemberCounts([{ id: "p1", organizationId: "o1" }]);
  const [explicit, implicit] = calls;

  const where = toSql(explicit.where[0]);
  expect(where.sql).toMatch(/"project_id" in \(\$1\)/);
  expect(where.sql).toMatch(/"role" not in \(\$2, \$3\)/);
  expect(where.params).toEqual(["p1", "org_owner", "org_admin"]);
  const memberJoin = toSql(explicit.innerJoin[3]).sql;
  expect(memberJoin).toContain('"member"."user_id" = "project_members"."user_id"');
  expect(memberJoin).toContain('"member"."organization_id" = "projects"."organization_id"');

  const admins = toSql(implicit.where[0]);
  expect(admins.sql).toMatch(/"organization_id" in \(\$1\).*"role" in \(\$2, \$3\)/);
  expect(admins.params).toEqual(["o1", "org_owner", "org_admin"]);
});
