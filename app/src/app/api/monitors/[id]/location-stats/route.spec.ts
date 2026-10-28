/** @jest-environment node */
const select = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: jest.fn() } }, select: (...a: unknown[]) => select(...a), selectDistinctOn: (...a: unknown[]) => select(...a) } }));
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

it("asks for the latest row per location, not the newest 100 overall (c21)", async () => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "o", projectId: "p" } as never);
  const called: string[] = [];
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const k of ["from", "where", "groupBy", "orderBy", "limit"]) b[k] = () => (called.push(k), b);
    b.then = (res: (v: unknown) => unknown) => Promise.resolve([]).then(res);
    return b;
  };
  select.mockImplementation(builder);
  await get();
  expect(called).not.toContain("limit");
});
