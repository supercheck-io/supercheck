/** @jest-environment node */
import { getProjectMemberCounts } from "./project-member-counts";

const results: unknown[][] = [];
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where"]) c[m] = () => c;
  c.groupBy = () => Promise.resolve(results.shift());
  return c;
};
const select = jest.fn(() => chain());
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => (select as jest.Mock)(...a) } }));

beforeEach(() => { select.mockClear(); results.length = 0; });

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
