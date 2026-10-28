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
