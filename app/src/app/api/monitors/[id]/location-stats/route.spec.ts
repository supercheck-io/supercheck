/** @jest-environment node */
const select = jest.fn();
const distinct = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: jest.fn() } }, select: (...a: unknown[]) => select(...a), selectDistinctOn: (...a: unknown[]) => distinct(...a) } }));
jest.mock("@/lib/auth-context", () => {
  class AuthError extends Error {
    status = 401;
  }
  return {
    authErrorStatus: (e: { status?: number }) => (e?.status === 403 ? 403 : 401),
    requireUserAuthContext: jest.fn(async () => ({ userId: "user" })),
    isAuthError: (e: unknown) => e instanceof AuthError,
    AuthError,
  };
});
const mockStanding = { value: true };
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn().mockResolvedValue(true),
  // Stands in for the real helper: 403 for an org member, 404 for a caller with no standing in the org.
  forbiddenOrNotFound: jest.fn(async (_u: string, _o: string, forbidden: string, notFound: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return mockStanding.value ? NextResponse.json({ error: forbidden }, { status: 403 }) : NextResponse.json({ error: notFound }, { status: 404 });
  }),
}));
jest.mock("drizzle-orm", () => {
  const actual = jest.requireActual("drizzle-orm");
  return { ...actual, gte: jest.fn(actual.gte) };
});
import { gte } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { GET } from "./route";
import { hasPermissionForUser } from "@/lib/rbac/middleware";

const get = () =>
  GET(new NextRequest("http://localhost/api/monitors/m/location-stats"), {
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }),
  });

it("keeps a 403 AuthError as 403", async () => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(Object.assign(new AuthError("no access"), { status: 403 }));
  expect((await get()).status).toBe(403);
});

it("answers 401 for an auth failure instead of 500 (c20)", async () => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(new AuthError("expired"));
  expect((await get()).status).toBe(401);
});

it("answers 403 to an organization member without view and 404 to another tenant", async () => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "o", projectId: "p" } as never);
  jest.mocked(hasPermissionForUser).mockResolvedValueOnce(false);
  mockStanding.value = true;
  expect((await get()).status).toBe(403);
  jest.mocked(hasPermissionForUser).mockResolvedValueOnce(false);
  mockStanding.value = false;
  expect((await get()).status).toBe(404);
  mockStanding.value = true;
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
