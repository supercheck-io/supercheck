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
    insert: () => ({ values: () => ({ returning: (...a: unknown[]) => insertReturning(...a) }) }),
  },
}));
jest.mock("@/db/schema", () => ({
  monitorNotificationSettings: {},
  notificationProviders: {},
  monitors: {},
}));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn(), count: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn().mockResolvedValue({ userId: "u1", projectId: "p1", isCliAuth: false }),
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const MONITOR_ID = "018f0000-0000-7000-8000-000000000001";
const call = () =>
  POST(
    new NextRequest("http://localhost/api/monitors/x/notifications", {
      method: "POST",
      body: JSON.stringify({ notificationProviderId: "prov-1" }),
    }),
    { params: Promise.resolve({ id: MONITOR_ID }) },
  );

describe("POST /api/monitors/[id]/notifications channel cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
