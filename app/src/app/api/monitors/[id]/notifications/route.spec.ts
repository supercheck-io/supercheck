/** @jest-environment node */
const monitorFindFirst = jest.fn();
const providerFindFirst = jest.fn();
const linkFindFirst = jest.fn();
const countWhere = jest.fn();
const insertReturning = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      monitors: { findFirst: (...a: unknown[]) => monitorFindFirst(...a) },
      notificationProviders: { findFirst: (...a: unknown[]) => providerFindFirst(...a) },
      monitorNotificationSettings: { findFirst: (...a: unknown[]) => linkFindFirst(...a) },
    },
    select: () => ({ from: () => ({ where: (...a: unknown[]) => countWhere(...a) }) }),
    insert: () => ({ values: () => ({ returning: (...a: unknown[]) => { callOrder.push("insert"); return insertReturning(...a); } }) }),
    delete: () => ({ where: () => ({ returning: (...a: unknown[]) => { callOrder.push("delete"); return deleteReturning(...a); } }) }),
    transaction: async (cb: (tx: unknown) => unknown) => cb(jest.requireMock("@/utils/db").db),
  },
}));
const deleteReturning = jest.fn();
const callOrder: string[] = [];
const mirrorProviderRowsToAlertConfig = jest.fn();
const lockMonitorRow = jest.fn();
jest.mock("@/lib/monitor-write", () => ({
  AlertConfigConflictError: class extends Error {},
  mirrorProviderRowsToAlertConfig: (...a: unknown[]) => {
    callOrder.push("mirror");
    return mirrorProviderRowsToAlertConfig(...a);
  },
  lockMonitorRow: (...a: unknown[]) => {
    callOrder.push("lock");
    return lockMonitorRow(...a);
  },
}));
jest.mock("@/db/schema", () => ({
  monitorNotificationSettings: {},
  notificationProviders: {},
  monitors: {},
}));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn(), isNull: jest.fn(), count: jest.fn() }));
const mockStanding = { value: true };
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn().mockResolvedValue(true),
  // Stands in for the real helper: 403 for an org member, 404 for a caller with no standing in the org.
  forbiddenOrNotFound: jest.fn(async (_u: string, _o: string, forbidden: string, notFound: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return mockStanding.value ? NextResponse.json({ error: forbidden }, { status: 403 }) : NextResponse.json({ error: notFound }, { status: 404 });
  }),
}));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn().mockResolvedValue({ userId: "u1", projectId: "p1", isCliAuth: false }),
  isAuthError: (e: { name?: string }) => e?.name === "AuthError",
  authErrorStatus: (e: { status?: number }) => e?.status ?? 401,
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "./route";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";

const MONITOR_ID = "018f0000-0000-7000-8000-000000000001";
const call = () =>
  POST(
    new NextRequest("http://localhost/api/monitors/x/notifications", {
      method: "POST",
      body: JSON.stringify({ notificationProviderId: "4b8e7c62-2f1d-4e5a-9c3b-8a7d6e5f4c3b" }),
    }),
    { params: Promise.resolve({ id: MONITOR_ID }) },
  );

describe("POST /api/monitors/[id]/notifications channel cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder.length = 0;
    delete process.env.MAX_MONITOR_NOTIFICATION_CHANNELS;
    monitorFindFirst.mockResolvedValue({ organizationId: "o1", projectId: "p1" });
    providerFindFirst.mockResolvedValue({ id: "prov-1" });
    linkFindFirst.mockResolvedValue(undefined);
    insertReturning.mockResolvedValue([{ id: "link-1" }]);
  });

  it("rejects linking beyond the per-monitor cap with the create/update error shape", async () => {
    countWhere.mockResolvedValue([{ value: 10 }]);
    const res = await call();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "You can only select up to 10 notification channels" });
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("honours MAX_MONITOR_NOTIFICATION_CHANNELS", async () => {
    process.env.MAX_MONITOR_NOTIFICATION_CHANNELS = "2";
    countWhere.mockResolvedValue([{ value: 2 }]);
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("You can only select up to 2 notification channels");
  });

  it("links when under the cap", async () => {
    countWhere.mockResolvedValue([{ value: 9 }]);
    const res = await call();
    expect(res.status).toBe(201);
    // alertConfig.notificationProviders follows the rows, in the same transaction.
    expect(mirrorProviderRowsToAlertConfig).toHaveBeenCalledWith(expect.anything(), MONITOR_ID);
    // Monitor row lock first, so concurrent links serialize and cannot deadlock with PUT/PATCH.
    expect(callOrder).toEqual(["lock", "insert", "mirror"]);
  });

  it("mirrors an unlink into alertConfig, and skips it when no link was removed", async () => {
    const unlink = () =>
      DELETE(
        new NextRequest("http://localhost/api/monitors/x/notifications", {
          method: "DELETE",
          body: JSON.stringify({ notificationProviderId: "4b8e7c62-2f1d-4e5a-9c3b-8a7d6e5f4c3b" }),
        }),
        { params: Promise.resolve({ id: MONITOR_ID }) },
      );
    deleteReturning.mockResolvedValueOnce([{ id: "link-1" }]);
    callOrder.length = 0;
    expect((await unlink()).status).toBe(200);
    expect(callOrder).toEqual(["lock", "delete", "mirror"]);
    expect(mirrorProviderRowsToAlertConfig).toHaveBeenCalledWith(expect.anything(), MONITOR_ID);
    mirrorProviderRowsToAlertConfig.mockClear();
    // Removing the last channel of an enabled alert that cannot open incidents is refused (and rolled back).
    deleteReturning.mockResolvedValueOnce([{ id: "link-1" }]);
    mirrorProviderRowsToAlertConfig.mockRejectedValueOnce(new (jest.requireMock("@/lib/monitor-write").AlertConfigConflictError)("At least one notification channel must be selected when alerts are enabled"));
    const refused = await unlink();
    expect(refused.status).toBe(400);
    mirrorProviderRowsToAlertConfig.mockClear();
    deleteReturning.mockResolvedValueOnce([]);
    expect((await unlink()).status).toBe(404);
    expect(mirrorProviderRowsToAlertConfig).not.toHaveBeenCalled();
  });
});

describe("/api/monitors/[id]/notifications access control", () => {
  const ctx = { params: Promise.resolve({ id: MONITOR_ID }) };
  const body = JSON.stringify({ notificationProviderId: "4b8e7c62-2f1d-4e5a-9c3b-8a7d6e5f4c3b" });
  const calls = {
    GET: () => GET(new NextRequest("http://localhost/api/monitors/x/notifications"), ctx),
    POST: () => POST(new NextRequest("http://localhost/api/monitors/x/notifications", { method: "POST", body }), ctx),
    DELETE: () => DELETE(new NextRequest("http://localhost/api/monitors/x/notifications", { method: "DELETE", body }), ctx),
  } as const;
  const methods = Object.keys(calls) as (keyof typeof calls)[];

  beforeEach(() => {
    jest.clearAllMocks();
    mockStanding.value = true;
    monitorFindFirst.mockResolvedValue({ organizationId: "o1", projectId: "p1" });
  });

  it.each(methods)("%s maps an auth failure to 401/403, not 500", async (method) => {
    const err = (status: number) => Object.assign(new Error("denied"), { name: "AuthError", status });
    (requireUserAuthContext as jest.Mock).mockRejectedValueOnce(err(401));
    expect((await calls[method]()).status).toBe(401);
    (requireUserAuthContext as jest.Mock).mockRejectedValueOnce(err(403));
    expect((await calls[method]()).status).toBe(403);
  });

  it.each(methods)("%s is 403 for an organization member and 404 for another tenant", async (method) => {
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    expect((await calls[method]()).status).toBe(403);
    mockStanding.value = false;
    expect((await calls[method]()).status).toBe(404);
    (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  });
});

it("rejects a malformed notification provider id with 400", async () => {
  const { POST } = jest.requireActual("./route") as typeof import("./route");
  const res = await POST(
    new NextRequest("http://localhost/api/monitors/93ce4a2e-7846-5b60-b753-1ab3563f0fce/notifications", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notificationProviderId: "prov-1" }),
    }),
    { params: Promise.resolve({ id: "93ce4a2e-7846-5b60-b753-1ab3563f0fce" }) },
  );
  expect(res.status).toBe(400);
});
