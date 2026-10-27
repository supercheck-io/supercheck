/** @jest-environment node */
import { NextRequest } from "next/server";

const selects: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const chain = () => {
  const rows = selects.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return c;
};
const mockRequireAuth = jest.fn();
const mockImpersonated = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    select: () => chain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: async () => [{ ...v }] };
      },
    }),
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: () => true,
  isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/pino-config", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { GET, POST } from "./route";

const jobId = "11111111-1111-4111-8111-111111111111";
const context = { userId: "u1", organizationId: "o1", project: { id: "p1" }, isCliAuth: false };
const post = (body: unknown) =>
  POST(
    new NextRequest(`https://app.example.com/api/jobs/${jobId}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: jobId }) },
  );

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-27T00:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  mockImpersonated.mockReset().mockResolvedValue(false);
  selects.length = 0;
  inserted.length = 0;
  // job lookup, duplicate-name check, per-job key count
  selects.push([{ id: jobId, organizationId: "o1", projectId: "p1", name: "Job" }], [], []);
});
afterEach(() => jest.useRealTimers());

describe("POST /api/jobs/[id]/api-keys", () => {
  it("lets a browser session create a never-expiring trigger key", async () => {
    mockRequireAuth.mockResolvedValue(context);
    expect((await post({ name: "ci" })).status).toBe(201);
    expect(inserted[0].expiresAt).toBeNull();
  });

  it("caps a trigger key minted by a CLI token at that token's expiry", async () => {
    const parentExpiry = new Date(Date.now() + 3600_000);
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: parentExpiry });
    expect((await post({ name: "ci" })).status).toBe(201);
    expect(inserted[0].expiresAt).toEqual(parentExpiry);
  });

  it("refuses when the authenticating CLI token has expired", async () => {
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await post({ name: "ci" })).status).toBe(401);
    expect(inserted).toHaveLength(0);
  });
});

describe("POST /api/jobs/[id]/api-keys impersonation guard", () => {
  it("refuses to mint a trigger key while a super admin is impersonating", async () => {
    mockRequireAuth.mockResolvedValue(context);
    mockImpersonated.mockResolvedValue(true);
    const res = await post({ name: "ci" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/impersonating/);
    expect(inserted).toHaveLength(0);
  });

  it("does not consult the session state for a CLI-token request (the key belongs to the bearer's owner)", async () => {
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true });
    mockImpersonated.mockResolvedValue(true);
    expect((await post({ name: "ci" })).status).toBe(201);
    expect(mockImpersonated).not.toHaveBeenCalled();
  });
});

describe("GET /api/jobs/[id]/api-keys", () => {
  it("returns the creator's avatar alongside the name", async () => {
    mockRequireAuth.mockResolvedValue(context);
    selects.length = 0;
    selects.push(
      [{ id: jobId, organizationId: "o1", projectId: "p1" }],
      [
        { id: "k1", name: "ci", start: "job_ab", enabled: true, createdAt: new Date(), expiresAt: null, jobId, lastRequest: null, createdByName: "Ada", createdByImage: "/api/users/u1/avatar?v=x" },
        { id: "k2", name: "old", start: "job_cd", enabled: true, createdAt: new Date(), expiresAt: null, jobId, lastRequest: null, createdByName: null, createdByImage: null },
      ],
    );

    const res = await GET(new NextRequest(`https://app.example.com/api/jobs/${jobId}/api-keys`), { params: Promise.resolve({ id: jobId }) });
    const body = await res.json();
    expect(body.apiKeys.map((k: Record<string, unknown>) => [k.createdByName, k.createdByImage])).toEqual([
      ["Ada", "/api/users/u1/avatar?v=x"],
      ["-", null],
    ]);
  });
});
