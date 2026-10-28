/** @jest-environment node */
import { NextRequest } from "next/server";
import { ilike } from "drizzle-orm";
import { tests } from "@/db/schema";

jest.mock("drizzle-orm", () => {
  const actual = jest.requireActual("drizzle-orm");
  return { ...actual, ilike: jest.fn(actual.ilike) };
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({
    organizationId: "org-1",
    project: { id: "project-1" },
  }),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/creators", () => ({ loadCreators: jest.fn(async () => () => ({})) }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {},
  SubscriptionAccessDeniedError: class extends Error {},
}));
const mockLimit = jest.fn();
const mockOffset = jest.fn();
jest.mock("@/utils/db", () => {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "innerJoin"]) q[m] = () => q;
    q.limit = (n: number) => { mockLimit(n); return q; };
    q.offset = (n: number) => { mockOffset(n); return q; };
    q.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return q;
  };
  let call = 0;
  return { db: { select: jest.fn(() => query(call++ === 0 ? [{ count: 0 }] : [])) } };
});

import { GET } from "./route";

it("searches case-insensitively with % and _ taken literally, and survives a non-numeric limit", async () => {
  const response = await GET(new NextRequest("http://localhost/api/tests?search=100%25_x&limit=abc&page=zz"));
  expect(response.status).toBe(200);
  expect(ilike).toHaveBeenCalledWith(tests.title, "%100\\%\\_x%");
  expect(mockLimit).toHaveBeenCalledWith(200);
  expect(mockOffset).toHaveBeenCalledWith(0);
});
