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
const mockResolveContext = jest.fn();
const mockCheckPermission = jest.fn();

const mockExecute = jest.fn(async () => undefined);
const mockTx = {
  select: () => chain(),
  execute: (...a: unknown[]) => (mockExecute as (...x: unknown[]) => unknown)(...a),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return { returning: async () => [{ ...v }] };
    },
  }),
};
jest.mock("@/utils/db", () => ({
  db: {
    select: () => mockTx.select(),
    transaction: async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCheckPermission(...a),
  resolveProjectPermissionContext: (...a: unknown[]) => mockResolveContext(...a),
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
  mockCheckPermission.mockReset().mockReturnValue(true);
  mockResolveContext.mockReset().mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "project_editor" } });
  selects.length = 0;
  inserted.length = 0;
  mockExecute.mockClear();
  // job lookup, then in the transaction: membership, duplicate-name check, per-job key count
  selects.push([{ id: jobId, organizationId: "o1", projectId: "p1", name: "Job" }], [{ id: "m1" }], [], []);
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

describe("POST /api/jobs/[id]/api-keys transaction checks", () => {
  it("takes the per-job advisory lock before checking and inserting", async () => {
    mockRequireAuth.mockResolvedValue(context);
    expect((await post({ name: "ci" })).status).toBe(201);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("keys the lock on the canonical job id read from the DB, not the raw URL spelling", async () => {
    const lower = "abcdefab-1111-4111-8111-abcdefabcdef";
    mockRequireAuth.mockResolvedValue(context);
    selects.length = 0;
    selects.push([{ id: lower, organizationId: "o1", projectId: "p1", name: "Job" }], [{ id: "m1" }], [], []);
    const upper = new NextRequest(`https://app.example.com/api/jobs/${lower.toUpperCase()}/api-keys`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "ci" }),
    });
    expect((await POST(upper, { params: Promise.resolve({ id: lower.toUpperCase() }) })).status).toBe(201);
    const chunks = ((mockExecute.mock.calls[0] as unknown[])[0] as { queryChunks: unknown[] }).queryChunks;
    const values = chunks.map((c) => (c as { value?: unknown })?.value ?? c);
    expect(values).toContain(lower);
    expect(values).not.toContain(lower.toUpperCase());
  });

  it("re-checks the expiry after the lock wait", async () => {
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: new Date(Date.now() + 1000) });
    mockExecute.mockImplementationOnce(async () => { jest.setSystemTime(Date.now() + 5000); });
    const res = await post({ name: "ci" });
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("refuses when the creator lost apiKey:create after the pre-lock check", async () => {
    mockRequireAuth.mockResolvedValue(context);
    mockCheckPermission.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect((await post({ name: "ci" })).status).toBe(403);
    expect(mockResolveContext).toHaveBeenCalledWith("u1", "p1");
    expect(inserted).toHaveLength(0);
  });

  it("refuses when the creator can no longer resolve a project context", async () => {
    mockRequireAuth.mockResolvedValue(context);
    mockResolveContext.mockResolvedValue(null);
    expect((await post({ name: "ci" })).status).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("re-checks the expiry just before the insert, after the in-lock checks", async () => {
    mockRequireAuth.mockResolvedValue({ ...context, isCliAuth: true, cliTokenExpiresAt: new Date(Date.now() + 1000) });
    mockResolveContext.mockImplementationOnce(async () => {
      jest.setSystemTime(Date.now() + 5000);
      return { userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "project_editor" } };
    });
    expect((await post({ name: "ci" })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("refuses when the creator is no longer a member of the organization", async () => {
    mockRequireAuth.mockResolvedValue(context);
    selects.length = 0;
    selects.push([{ id: jobId, organizationId: "o1", projectId: "p1", name: "Job" }], []);
    expect((await post({ name: "ci" })).status).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("returns 409 for a duplicate name and 400 at the 10-key cap, without inserting", async () => {
    mockRequireAuth.mockResolvedValue(context);
    selects.length = 0;
    selects.push([{ id: jobId, organizationId: "o1", projectId: "p1", name: "Job" }], [{ id: "m1" }], [{ id: "k" }]);
    expect((await post({ name: "ci" })).status).toBe(409);
    selects.length = 0;
    selects.push([{ id: jobId, organizationId: "o1", projectId: "p1", name: "Job" }], [{ id: "m1" }], [], Array.from({ length: 10 }, (_, i) => ({ id: `k${i}` })));
    expect((await post({ name: "ci" })).status).toBe(400);
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
