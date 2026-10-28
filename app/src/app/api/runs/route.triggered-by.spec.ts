/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/creators", () => ({
  loadCreators: jest.fn(async () => (id: string | null) =>
    id === "u1" ? { createdByName: "Ada", createdByImage: "/api/users/u1/avatar?v=x" } : { createdByName: null, createdByImage: null }),
}));

import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { requireAuthContext } from "@/lib/auth-context";
import { loadCreators } from "@/lib/creators";
import { GET } from "./route";

it("returns who triggered each run and the trigger key name", async () => {
  jest.mocked(requireAuthContext).mockResolvedValue({ organizationId: "org-1", project: { id: "project-1" } } as never);
  const rows = [
    { id: "r1", trigger: "manual", triggeredByUserId: "u1", triggerKeyName: null, startedAt: null, completedAt: null },
    { id: "r2", trigger: "remote", triggeredByUserId: "u1", triggerKeyName: "ci-key", startedAt: null, completedAt: null },
    { id: "r3", trigger: "schedule", triggeredByUserId: null, triggerKeyName: null, startedAt: null, completedAt: null },
  ];
  let call = 0;
  jest.mocked(db.select).mockImplementation((() => {
    const result = call++ === 0 ? [{ count: 3 }] : rows;
    const query: Record<string, unknown> = {};
    for (const method of ["from", "leftJoin", "where", "orderBy", "offset", "limit"]) query[method] = jest.fn(() => query);
    query.then = (resolve: (r: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  }) as never);

  const body = await (await GET(new NextRequest("http://localhost/api/runs"))).json();

  expect(loadCreators).toHaveBeenCalledWith(["u1", "u1", null]);
  expect(body.data[0]).not.toHaveProperty("triggeredByUserId");
  expect(body.data.map((run: Record<string, unknown>) => [run.triggeredByName, run.triggeredByImage, run.triggerKeyName])).toEqual([
    ["Ada", "/api/users/u1/avatar?v=x", null],
    ["Ada", "/api/users/u1/avatar?v=x", "ci-key"],
    [null, null, null],
  ]);
});
