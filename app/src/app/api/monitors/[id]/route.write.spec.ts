/** @jest-environment node */

const findFirst = jest.fn();
const testsFindFirst = jest.fn();
const update = jest.fn();
const transaction = jest.fn();
const dbSelect = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      monitors: { findFirst: (...a: unknown[]) => findFirst(...a) },
      tests: { findFirst: (...a: unknown[]) => testsFindFirst(...a) },
    },
    update: (...a: unknown[]) => update(...a),
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: (...a: unknown[]) => transaction(...a),
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({ userId: "user-1", organizationId: "org-1", project: { id: "project-1" } }),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn().mockReturnValue(true) }));
jest.mock("@/lib/monitor-scheduler", () => ({ scheduleMonitor: jest.fn().mockResolvedValue("s"), deleteScheduledMonitor: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/execution/trial-interval-response", () => ({
  trialIntervalErrorResponse: jest.fn().mockResolvedValue(null),
  monitorResumeBlockedResponse: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@/lib/queue", () => ({ addMonitorExecutionJobToQueue: jest.fn() }));
jest.mock("@/lib/location-registry", () => ({
  getWorkloadCapableLocationCodes: jest.fn().mockResolvedValue(["eu-central"]),
  getProjectAvailableLocationCodes: jest.fn().mockResolvedValue(["eu-central"]),
  getAllEnabledLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR: "restricted",
}));
jest.mock("@/lib/worker-registry", () => ({ getActiveWorkerQueueNames: jest.fn() }));

import { NextRequest } from "next/server";
import { PATCH, PUT } from "./route";

const ID = "00000000-0000-4000-8000-000000000002";
const stored = {
  id: ID,
  type: "http_request",
  target: "https://example.com",
  projectId: "project-1",
  organizationId: "org-1",
  frequencyMinutes: 5,
  enabled: true,
  status: "up",
  scheduledJobId: "s",
  config: { timeoutSeconds: 30, aggregatedAlertState: { n: 4 }, sslLastCheckedAt: "t" },
  alertConfig: null,
};
const call = (handler: typeof PUT | typeof PATCH, method: string, body: object) =>
  handler(new NextRequest(`http://localhost/api/monitors/${ID}`, { method, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: ID }),
  });

let set: jest.Mock;
let txInsertValues: jest.Mock;
let providerRows: { id: string }[];
beforeEach(() => {
  jest.clearAllMocks();
  findFirst.mockResolvedValue(stored);
  testsFindFirst.mockResolvedValue({ id: "t", title: "T" });
  providerRows = [];
  txInsertValues = jest.fn().mockReturnValue({ onConflictDoNothing: jest.fn() });
  set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([stored]) }) });
  update.mockReturnValue({ set });
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      update: () => ({ set }),
      select: () => ({ from: () => ({ where: async () => providerRows }) }),
      delete: () => ({ where: async () => undefined }),
      insert: () => ({ values: txInsertValues }),
    }),
  );
});

const payload = () => set.mock.calls[0][0] as Record<string, unknown>;

describe("monitor PUT write boundary", () => {
  it("does not let the body move a monitor to another tenant (c7)", async () => {
    await call(PUT, "PUT", { name: "x", projectId: "00000000-0000-4000-8000-0000000000b1", organizationId: "00000000-0000-4000-8000-0000000000b2", createdByUserId: "00000000-0000-4000-8000-0000000000b3", scheduledJobId: "z" });
    const p = payload();
    expect(p).toMatchObject({ name: "x" });
    for (const k of ["projectId", "organizationId", "createdByUserId", "scheduledJobId", "id"]) expect(p).not.toHaveProperty(k);
  });

  it("keeps worker-owned config keys when config is replaced (c2)", async () => {
    await call(PUT, "PUT", { config: { timeoutSeconds: 10 } });
    expect((payload().config as Record<string, unknown>)).toMatchObject({ timeoutSeconds: 10, aggregatedAlertState: { n: 4 }, sslLastCheckedAt: "t" });
  });

  it("resuming with status alone also re-enables the monitor (c6)", async () => {
    findFirst.mockResolvedValue({ ...stored, enabled: false, status: "paused" });
    await call(PUT, "PUT", { status: "up" });
    expect(payload()).toMatchObject({ status: "up", enabled: true });
  });

  it("refuses a synthetic testId from another project (c8)", async () => {
    findFirst.mockResolvedValue({ ...stored, type: "synthetic_test", config: { testId: "00000000-0000-4000-8000-000000000009" } });
    testsFindFirst.mockResolvedValue(undefined);
    const res = await call(PUT, "PUT", { config: { testId: "00000000-0000-4000-8000-0000000000aa" } });
    expect(res.status).toBe(404);
    expect(set).not.toHaveBeenCalled();
  });

  it("defaults alertOnRecovery to true like create does (c11)", async () => {
    providerRows = [{ id: "00000000-0000-4000-8000-0000000000c1" }];
    await call(PUT, "PUT", { alertConfig: { enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000c1"], alertOnFailure: true } });
    expect(payload().alertConfig).toMatchObject({ alertOnRecovery: true });
  });

  it("PUT without alertOnRecovery keeps a stored false (pull then deploy round trip)", async () => {
    findFirst.mockResolvedValue({
      ...stored,
      alertConfig: { enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000c1"], alertOnFailure: true, alertOnRecovery: false, alertOnSslExpiration: true, failureThreshold: 3, recoveryThreshold: 2, customMessage: "m" },
    });
    providerRows = [{ id: "00000000-0000-4000-8000-0000000000c1" }];
    await call(PUT, "PUT", { alertConfig: { enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000c1"] } });
    expect(payload().alertConfig).toMatchObject({ alertOnRecovery: false, alertOnSslExpiration: true, failureThreshold: 3, recoveryThreshold: 2, customMessage: "m" });
  });

  it("PUT keeps a stored enabled=true when alertConfig omits enabled", async () => {
    findFirst.mockResolvedValue({ ...stored, alertConfig: { enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000c1"], alertOnFailure: true } });
    providerRows = [{ id: "00000000-0000-4000-8000-0000000000c1" }];
    await call(PUT, "PUT", { alertConfig: { notificationProviders: ["00000000-0000-4000-8000-0000000000c1"] } });
    expect(payload().alertConfig).toMatchObject({ enabled: true });
  });

  it("rejects a malformed provider id before any database access", async () => {
    const res = await call(PUT, "PUT", { alertConfig: { enabled: true, notificationProviders: ["not-a-uuid"], alertOnFailure: true } });
    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([{ status: "paused", enabled: true }, { status: "up", enabled: false }])("rejects disagreeing %j", async (body) => {
    expect((await call(PUT, "PUT", body)).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects config null instead of wiping the stored config", async () => {
    expect((await call(PUT, "PUT", { config: null })).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it.each([2.5, -1, 0, 1000])("rejects failureThreshold %p (c16)", async (failureThreshold) => {
    const res = await call(PUT, "PUT", { alertConfig: { enabled: false, notificationProviders: [], failureThreshold } });
    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects assertion keys the worker never evaluates (c15)", async () => {
    const res = await call(PUT, "PUT", { config: { responseBodyJsonPath: { path: "$.a", expectedValue: 1 } } });
    expect(res.status).toBe(400);
  });
});

describe("switching to a synthetic monitor re-checks the stored testId", () => {
  it.each([["PUT", PUT], ["PATCH", PATCH]] as const)("%s refuses a stored foreign testId", async (method, handler) => {
    findFirst.mockResolvedValue({ ...stored, config: { testId: "00000000-0000-4000-8000-0000000000aa" } });
    testsFindFirst.mockResolvedValue(undefined);
    const res = await call(handler, method, { type: "synthetic_test" });
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});

it("a stored legacy assertion key does not block an unrelated edit", async () => {
  findFirst.mockResolvedValue({ ...stored, config: { ...stored.config, checkExpiration: true } });
  expect((await call(PATCH, "PATCH", { enabled: false })).status).toBe(200);
});

describe("monitor PATCH alertConfig (c12)", () => {
  it("replaces the delivery rows when providers change", async () => {
    providerRows = [{ id: "00000000-0000-4000-8000-0000000000c1" }];
    const res = await call(PATCH, "PATCH", { alertConfig: { enabled: true, notificationProviders: ["00000000-0000-4000-8000-0000000000c1"] } });
    expect(res.status).toBe(200);
    expect(txInsertValues).toHaveBeenCalledWith([{ monitorId: ID, notificationProviderId: "00000000-0000-4000-8000-0000000000c1" }]);
  });

  it("rejects providers outside the project and writes nothing", async () => {
    providerRows = [];
    const res = await call(PATCH, "PATCH", { alertConfig: { enabled: true, notificationProviders: ["foreign"] } });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an enabled alert config with no channel", async () => {
    const res = await call(PATCH, "PATCH", { alertConfig: { enabled: true, notificationProviders: [] } });
    expect(res.status).toBe(400);
  });
});

describe("synthetic monitors keep the 5-minute minimum", () => {
  const synthetic = { ...stored, type: "synthetic_test", config: { testId: "t" } };
  it.each([["PUT", PUT], ["PATCH", PATCH]] as const)("%s rejects a 1-minute synthetic frequency", async (method, handler) => {
    findFirst.mockResolvedValue(synthetic);
    const res = await call(handler, method, { frequencyMinutes: 1 });
    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it("PUT rejects switching a 1-minute monitor to synthetic", async () => {
    findFirst.mockResolvedValue({ ...stored, frequencyMinutes: 1 });
    const res = await call(PUT, "PUT", { type: "synthetic_test", config: { testId: "t" } });
    expect(res.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it.each([["PATCH", PATCH, { enabled: false }], ["PUT", PUT, { name: "renamed" }]] as const)(
    "%s still pauses or renames a legacy sub-5-minute synthetic monitor",
    async (method, handler, body) => {
      findFirst.mockResolvedValue({ ...synthetic, frequencyMinutes: 1 });
      const res = await call(handler, method, body);
      expect(await res.json()).not.toMatchObject({ error: "Invalid frequency" });
    },
  );
  it("still allows 1 minute for non-synthetic monitors", async () => {
    const res = await call(PATCH, "PATCH", { frequencyMinutes: 1 });
    expect(res.status).not.toBe(400);
  });
});
