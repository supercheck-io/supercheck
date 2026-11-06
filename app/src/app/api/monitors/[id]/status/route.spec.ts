/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: jest.fn() } }, update: jest.fn(), transaction: jest.fn() } }));
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
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const monitorResumeBlockedResponse = jest.fn();
jest.mock("@/lib/execution/trial-interval-response", () => ({
  monitorResumeBlockedResponse: (...a: unknown[]) => monitorResumeBlockedResponse(...a),
}));
const withResumeWithinPlan = jest.fn();
jest.mock("@/lib/middleware/plan-enforcement", () => ({ withResumeWithinPlan: (...a: unknown[]) => withResumeWithinPlan(...a) }));
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { PATCH } from "./route";

const patch = (status: string) =>
  PATCH(new NextRequest("http://localhost/api/monitors/m/status", { method: "PATCH", body: JSON.stringify({ status }) }), {
    params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  monitorResumeBlockedResponse.mockResolvedValue(null);
  // A resume runs its write on the plan-limit transaction; the stub hands it the mocked db transaction.
  withResumeWithinPlan.mockImplementation(async (_org: string, _resource: string, write: (tx: unknown) => Promise<unknown>) => ({
    ok: true,
    value: await (db.transaction as jest.Mock)(write),
  }));
});

it.each([{ organizationId: null, projectId: "project" }, { organizationId: "org", projectId: null }])("does not mutate a monitor with missing scope", async (scope) => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "monitor", ...scope } as never);
  const response = await PATCH(new NextRequest("http://localhost/api/monitors/monitor/status", { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), { params: Promise.resolve({ id: "monitor" }) });
  expect(response.status).toBe(404);
  expect(db.update).not.toHaveBeenCalled();
});

it("refuses to resume a paused monitor without a plan (c9)", async () => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "org", projectId: "p", status: "paused" } as never);
  jest.mocked(hasPermissionForUser).mockResolvedValue(true);
  monitorResumeBlockedResponse.mockResolvedValue(Response.json({ error: "Active subscription required." }, { status: 402 }));
  const response = await patch("up");
  expect(response.status).toBe(402);
  expect(monitorResumeBlockedResponse).toHaveBeenCalledWith("org", "paused", { status: "up" });
  expect(db.update).not.toHaveBeenCalled();
});

it("keeps a 403 AuthError as 403", async () => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(Object.assign(new AuthError("no access"), { status: 403 }));
  expect((await patch("paused")).status).toBe(403);
});

it("answers 401 for an auth failure instead of 500 (c20)", async () => {
  const { AuthError } = jest.requireMock("@/lib/auth-context");
  jest.mocked(requireUserAuthContext).mockRejectedValueOnce(new AuthError("expired"));
  expect((await patch("paused")).status).toBe(401);
});

function lockedTx(liveProjects: unknown[], updated: unknown[] = []) {
  const wheres: string[] = [];
  const forShare = jest.fn(async () => liveProjects);
  const update = jest.fn(() => ({ set: () => ({ where: () => ({ returning: async () => updated }) }) }));
  (db.transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      select: () => ({
        from: () => ({
          where: (condition: SQL) => {
            wheres.push(new PgDialect().sqlToQuery(condition).sql);
            return { for: forShare };
          },
        }),
      }),
      update,
    }),
  );
  return { wheres, forShare, update };
}

describe("locked status write", () => {
  beforeEach(() => {
    jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "org", projectId: "p", status: "paused" } as never);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
  });

  it("locks only a live project row before writing", async () => {
    const { wheres, forShare } = lockedTx([]);
    const response = await patch("up");
    expect(forShare).toHaveBeenCalledWith("share");
    expect(wheres[0]).toContain(`"projects"."status" <> $`);
    expect(response.status).toBe(404);
  });

  it("updates the monitor when its project is live", async () => {
    const { update } = lockedTx([{ id: "p" }], [{ id: "m", name: "M", organizationId: "org", projectId: "p", status: "up" }]);
    const response = await patch("up");
    expect(update).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

describe("resuming under the plan limit", () => {
  beforeEach(() => {
    jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "org", projectId: "p", status: "paused" } as never);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
  });

  it("answers 403 and does not write when the plan has no free slot", async () => {
    withResumeWithinPlan.mockResolvedValue({ ok: false, denied: { allowed: false, error: "Your plus plan allows 5 active monitors.", limit: 5, upgrade: "pro" } });
    const response = await patch("up");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "plan_limit", limit: 5, upgrade: "pro" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("answers 503 when the plan-limit lock is busy", async () => {
    withResumeWithinPlan.mockResolvedValue({ ok: false, busy: true });
    const response = await patch("up");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  it("does not take a plan slot to pause", async () => {
    lockedTx([{ id: "p" }], [{ id: "m", name: "M", organizationId: "org", projectId: "p", status: "paused" }]);
    const response = await patch("paused");
    expect(response.status).toBe(200);
    expect(withResumeWithinPlan).not.toHaveBeenCalled();
  });
});
