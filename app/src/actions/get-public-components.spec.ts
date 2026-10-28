/** @jest-environment node */
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "groupBy"]) c[m] = () => c;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve([]).then(r);
  return c;
};
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) },
      statusPageComponents: {
        // Mirrors Drizzle: the relation is only returned when requested.
        findMany: jest.fn(async (args: { with?: { monitors?: unknown } }) => [
          {
            id: "c1",
            name: "API",
            status: "operational",
            ...(args.with?.monitors
              ? { monitors: [{ weight: 1, monitor: { id: "m1", name: "prod-payments-db-eu1", status: "up" } }] }
              : {}),
          },
        ]),
      },
    },
    select: () => chain(),
  },
}));
import { getPublicComponents } from "./get-public-components";

it("does not expose linked monitor names, ids or status to anonymous visitors", async () => {
  const result = await getPublicComponents("00000000-0000-4000-8000-000000000001");
  expect(result.success).toBe(true);
  const json = JSON.stringify(result.components);
  expect(json).not.toContain("prod-payments-db-eu1");
  expect(json).not.toContain("m1");
  expect(result.components[0]).not.toHaveProperty("monitors");
  expect(result.components[0]).not.toHaveProperty("monitorIds");
  expect(result.components[0]).toHaveProperty("dailyMetrics");
});

it("honours the component aggregation method when combining monitor uptime", async () => {
  const { db } = jest.requireMock("@/utils/db");
  (db.query.statusPageComponents.findMany as jest.Mock).mockResolvedValueOnce([
    { id: "c1", name: "API", status: "operational", aggregationMethod: "best_case", failureThreshold: 1, monitors: [] },
  ]);
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const rows = [
    { componentId: "c1", monitorId: "m1", weight: 1, date: "2030-01-01", totalChecks: 100, successfulChecks: 100 },
    { componentId: "c1", monitorId: "m2", weight: 1, date: "2030-01-01", totalChecks: 100, successfulChecks: 0 },
  ];
  let call = 0;
  db.select = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "groupBy"]) c[m] = () => c;
    const result = call++ === 0 ? rows : [];
    c.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
    return c;
  };
  const result = await getPublicComponents("00000000-0000-4000-8000-000000000001");
  expect(result.components[0].dailyMetrics).toEqual([{ date: "2030-01-01", totalChecks: 100, successfulChecks: 100 }]);
});
