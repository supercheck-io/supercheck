/** @jest-environment node */
const select = jest.fn();
const distinct = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: jest.fn() } }, select: (...a: unknown[]) => select(...a), selectDistinctOn: (...a: unknown[]) => distinct(...a) } }));
jest.mock("@/lib/auth-context", () => {
  class AuthError extends Error {
    status = 401;
  }
  return {
    requireUserAuthContext: jest.fn(async () => ({ userId: "user" })),
    isAuthError: (e: unknown) => e instanceof AuthError,
    AuthError,
  };
});
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn().mockResolvedValue(true) }));
jest.mock("drizzle-orm", () => {
  const actual = jest.requireActual("drizzle-orm");
  return { ...actual, gte: jest.fn(actual.gte) };
});
import { gte } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { GET } from "./route";

const get = () =>
  GET(new NextRequest("http://localhost/api/monitors/m/location-stats"), {
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }),
  });

it("answers 401 for an auth failure instead of 500 (c20)", async () => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(new AuthError("expired"));
  expect((await get()).status).toBe(401);
});

const builder = (rows: unknown[], wheres: unknown[] = []) => {
  const b: Record<string, unknown> = {};
  for (const k of ["from", "groupBy", "orderBy"]) b[k] = () => b;
  b.where = (w: unknown) => (wheres.push(w), b);
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
  return b;
};
it("returns the latest row per location, bounded to the requested period (c21)", async () => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "o", projectId: "p" } as never);
  jest.mocked(gte).mockClear();
  const wheres: unknown[] = [];
  const t = new Date("2026-01-02T00:00:00Z");
  select.mockImplementation(() =>
    builder([{ location: "eu", totalChecks: 4, upChecks: 3, avgResponseTime: 10, minResponseTime: 5, maxResponseTime: 20 }]),
  );
  distinct.mockImplementation(() =>
    builder([{ location: "eu", checkedAt: t, status: "up", isUp: true, responseTimeMs: 7 }], wheres),
  );
  const res = await get();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0].latest).toMatchObject({ status: "up", responseTimeMs: 7, checkedAt: t.toISOString() });
  expect(distinct).toHaveBeenCalledTimes(1);
  // One gte for the stats query and one for the latest-result query.
  expect(jest.mocked(gte)).toHaveBeenCalledTimes(2);
});
