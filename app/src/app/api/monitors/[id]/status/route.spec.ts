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
  ensureSubscribedForResume: (...a: unknown[]) => ensureSubscribedForResume(...a),
  subscriptionDeniedResponse: (e: { denied?: boolean }) => (e?.denied ? Response.json({ error: "Trial ended" }, { status: 402 }) : null),
}));
const ensureSubscribedForResume = jest.fn();
const withResumeWithinPlan = jest.fn();
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  ...jest.requireActual("@/lib/middleware/plan-enforcement"),
  withResumeWithinPlan: (...a: unknown[]) => withResumeWithinPlan(...a),
}));
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
  withResumeWithinPlan.mockImplementation(async (_org: string, _resource: string, _id: string, write: (tx: unknown) => Promise<unknown>) => ({
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

const deleteScheduledMonitor = jest.fn(async (..._a: unknown[]) => true);
const scheduleMonitor = jest.fn(async () => "sched-new");
jest.mock("@/lib/monitor-scheduler", () => ({
  removeScheduledMonitor: (...a: unknown[]) => (deleteScheduledMonitor as jest.Mock)(...a),
  scheduleMonitor: (...a: unknown[]) => (scheduleMonitor as jest.Mock)(...a),
}));

describe("schedule is reconciled to the committed state", () => {
  beforeEach(() => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    (db.update as jest.Mock).mockReturnValue({ set: jest.fn(() => ({ where: jest.fn() })) });
  });
  const base = { id: "m", organizationId: "org", projectId: "p", frequencyMinutes: 5, type: "website", target: "https://e.com", config: {}, enabled: true };
  // First transaction is the status write; a later one is the reconcile, which reads the committed row.
  const useDb = (written: object, committed: object) => {
    const tx = () => ({
      execute: jest.fn(),
      select: () => ({ from: () => ({ where: () => ({ for: async (mode: string) => (mode === "share" ? [{ id: "p" }] : [committed]) }) }) }),
      update: () => ({ set: jest.fn(() => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [written] }) })) }),
    });
    (db.transaction as jest.Mock).mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx()));
  };
  const stored = (status: string, extra: object = {}) =>
    jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ ...base, status, scheduledJobId: "old", ...extra } as never);

  it("removes the schedule after a pause commits", async () => {
    stored("up");
    useDb({ ...base, status: "paused" }, { ...base, status: "paused", enabled: false, scheduledJobId: "old" });
    expect((await patch("paused")).status).toBe(200);
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("old");
    expect(scheduleMonitor).not.toHaveBeenCalled();
  });

  it("schedules after a resume commits", async () => {
    stored("paused");
    useDb({ ...base, status: "pending" }, { ...base, status: "pending", scheduledJobId: null });
    expect((await patch("pending")).status).toBe(200);
    expect(scheduleMonitor).toHaveBeenCalledWith(expect.objectContaining({ monitorId: expect.any(String), frequencyMinutes: 5 }));
    expect(deleteScheduledMonitor).not.toHaveBeenCalled();
  });

  it("follows the committed row when a concurrent resume committed after this pause", async () => {
    // This request paused, but a later resume already committed: the reconcile must schedule, not delete.
    stored("up");
    useDb({ ...base, status: "paused" }, { ...base, status: "up", scheduledJobId: null });
    expect((await patch("paused")).status).toBe(200);
    expect(scheduleMonitor).toHaveBeenCalledTimes(1);
    expect(deleteScheduledMonitor).not.toHaveBeenCalled();
  });

  it("follows the committed row when a concurrent pause committed after this resume", async () => {
    stored("paused");
    useDb({ ...base, status: "pending" }, { ...base, status: "paused", enabled: false, scheduledJobId: "x" });
    expect((await patch("pending")).status).toBe(200);
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("x");
    expect(scheduleMonitor).not.toHaveBeenCalled();
  });

  it("a failed scheduler delete gives 503, keeps scheduledJobId, and a retry converges", async () => {
    stored("up");
    const clears: unknown[] = [];
    const committed = { ...base, status: "paused", enabled: false, scheduledJobId: "old" };
    (db.transaction as jest.Mock).mockImplementation(async (cb: (t: unknown) => unknown) => {
      const pending: unknown[] = [];
      const result = await cb({
        execute: jest.fn(),
        select: () => ({ from: () => ({ where: () => ({ for: async (mode: string) => (mode === "share" ? [{ id: "p" }] : [committed]) }) }) }),
        update: () => ({ set: jest.fn((v: unknown) => ({ where: () => { pending.push(v); return Object.assign(Promise.resolve(), { returning: async () => [{ ...base, status: "paused" }] }); } })) }),
      });
      clears.push(...pending.filter((v) => (v as { scheduledJobId?: unknown }).scheduledJobId === null));
      return result;
    });
    deleteScheduledMonitor.mockRejectedValueOnce(new Error("redis down"));
    const failed = await patch("paused");
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toMatch(/Retry/);
    expect(clears).toHaveLength(0); // scheduledJobId was not cleared
    // The first write committed, so the stored row now reads paused (still holding its job id).
    stored("paused");
    const retry = await patch("paused");
    expect(retry.status).toBe(200);
    expect(deleteScheduledMonitor).toHaveBeenLastCalledWith("old"); // job removed
    expect(clears).toHaveLength(1); // scheduledJobId cleared
  });

  it.each([
    ["delete", "paused", { status: "paused", enabled: false, scheduledJobId: "old" }, deleteScheduledMonitor],
    ["schedule", "up", { status: "up", scheduledJobId: null }, scheduleMonitor],
  ] as const)("a hung scheduler %s gives 503 within the deadline, keeps scheduledJobId, and a retry converges", async (_n, status, committedExtra, fn) => {
    stored(status);
    const clears: unknown[] = [];
    const committed = { ...base, ...committedExtra };
    (db.transaction as jest.Mock).mockImplementation(async (cb: (t: unknown) => unknown) => {
      const pending: unknown[] = [];
      const result = await cb({
        execute: jest.fn(),
        select: () => ({ from: () => ({ where: () => ({ for: async (mode: string) => (mode === "share" ? [{ id: "p" }] : [committed]) }) }) }),
        update: () => ({ set: jest.fn((v: unknown) => ({ where: () => { pending.push(v); return Object.assign(Promise.resolve(), { returning: async () => [{ ...base, status }] }); } })) }),
      });
      clears.push(...pending.filter((v) => "scheduledJobId" in (v as object)));
      return result;
    });
    (fn as jest.Mock).mockImplementationOnce(() => new Promise(() => {})); // never settles
    jest.useFakeTimers();
    try {
      let code: number | undefined;
      const pending = patch(status).then((r) => { code = r.status; });
      await jest.advanceTimersByTimeAsync(1999);
      expect(code).toBeUndefined(); // still within the deadline
      await jest.advanceTimersByTimeAsync(2);
      await pending;
      expect(code).toBe(503);
    } finally {
      jest.useRealTimers();
    }
    expect(clears).toHaveLength(0); // scheduledJobId untouched
    expect((await patch(status)).status).toBe(200); // retry converges
    expect(clears).toHaveLength(1);
  });

  it("a hung fallback delete by monitor id (no job under scheduledJobId) also gives 503", async () => {
    stored("paused");
    useDb({ ...base, status: "paused" }, { ...base, status: "paused", enabled: false, scheduledJobId: "old" });
    deleteScheduledMonitor.mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise(() => {}));
    jest.useFakeTimers();
    try {
      let code: number | undefined;
      const pending = patch("paused").then((r) => { code = r.status; });
      await jest.advanceTimersByTimeAsync(2001);
      await pending;
      expect(code).toBe(503);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reconciles even when the pre-write read says the status did not change", async () => {
    // The request read "paused" and asks for "paused" while a concurrent resume committed: the row decides.
    stored("paused");
    useDb({ ...base, status: "paused" }, { ...base, status: "up", scheduledJobId: null });
    expect((await patch("paused")).status).toBe(200);
    expect(scheduleMonitor).toHaveBeenCalledTimes(1);
  });
});

it.each(["error", "maintenance", "bogus", ""])("rejects status %p before any lookup", async (status) => {
  const response = await patch(status);
  expect(response.status).toBe(400);
  expect(db.query.monitors.findFirst).not.toHaveBeenCalled();
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
  const update = jest.fn(() => ({ set: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => updated }) }) }));
  (db.transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      execute: jest.fn(),
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

  it("answers 402 when a concurrent trial end made the monitor paused after the pre-lock read", async () => {
    withResumeWithinPlan.mockRejectedValue(Object.assign(new Error("Trial ended"), { denied: true }));
    const response = await patch("up");
    expect(response.status).toBe(402);
    const guard = withResumeWithinPlan.mock.calls[0][4] as () => Promise<void>;
    await guard();
    expect(ensureSubscribedForResume).toHaveBeenCalledWith("org");
  });

  it("answers 503 when the plan-limit lock is busy", async () => {
    withResumeWithinPlan.mockResolvedValue({ ok: false, busy: true });
    const response = await patch("up");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  it("uses the lock even when the monitor was read as active (a concurrent pause makes that read stale)", async () => {
    jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "m", organizationId: "org", projectId: "p", status: "up" } as never);
    lockedTx([{ id: "p" }], [{ id: "m", name: "M", organizationId: "org", projectId: "p", status: "up" }]);
    const response = await patch("up");
    expect(response.status).toBe(200);
    expect(withResumeWithinPlan).toHaveBeenCalledWith("org", "monitor", "00000000-0000-4000-8000-000000000002", expect.any(Function), expect.any(Function));
  });

  it("does not take a plan slot to pause", async () => {
    lockedTx([{ id: "p" }], [{ id: "m", name: "M", organizationId: "org", projectId: "p", status: "paused" }]);
    const response = await patch("paused");
    expect(response.status).toBe(200);
    expect(withResumeWithinPlan).not.toHaveBeenCalled();
  });
});
