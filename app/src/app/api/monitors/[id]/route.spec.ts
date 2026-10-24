/** @jest-environment node */

const findFirst = jest.fn();
const update = jest.fn();

jest.mock("@/utils/db", () => ({
  db: { query: { monitors: { findFirst: (...args: unknown[]) => findFirst(...args) } }, update: (...args: unknown[]) => update(...args) },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1" },
  }),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn().mockReturnValue(true),
}));
jest.mock("@/lib/monitor-scheduler", () => ({
  scheduleMonitor: jest.fn(),
  deleteScheduledMonitor: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@/lib/queue", () => ({}));
jest.mock("@/lib/monitor-validation", () => ({
  validateMonitorConfiguration: jest.fn().mockReturnValue({ success: true }),
}));
jest.mock("@/lib/location-registry", () => ({
  // Browser-capable: EU only. Project may use all three regions.
  getWorkloadCapableLocationCodes: jest.fn().mockResolvedValue(["eu-central"]),
  getProjectAvailableLocationCodes: jest
    .fn()
    .mockResolvedValue(["eu-central", "us-east", "asia-pacific"]),
  getAllEnabledLocationCodes: jest.fn(),
  getDefaultLocationCodes: jest.fn(),
  getFirstDefaultLocationCode: jest.fn(),
  hasProjectLocationRestrictions: jest.fn(),
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR: "restricted",
}));
jest.mock("@/lib/worker-registry", () => ({ getActiveWorkerQueueNames: jest.fn() }));

import { NextRequest } from "next/server";
import { DELETE, PATCH, PUT } from "./route";

const locationConfig = (locations: string[], enabled = true) => ({
  enabled,
  locations,
  threshold: 50,
  strategy: "majority",
});

const existing = (type: string, config: object = {}) => ({
  id: "00000000-0000-4000-8000-000000000002",
  type,
  target: "https://example.com",
  projectId: "project-1",
  organizationId: "org-1",
  config,
});

const call = (
  handler: typeof PUT | typeof PATCH,
  method: "PUT" | "PATCH",
  body: object,
) =>
  handler(
    new NextRequest("http://localhost/api/monitors/00000000-0000-4000-8000-000000000002", {
      method,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }) },
  );

describe("monitor update location validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    update.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }),
      }),
    });
  });

  it("PATCH rejects an unsupported synthetic selection and never writes", async () => {
    findFirst.mockResolvedValue(existing("synthetic_test"));
    const response = await call(PATCH, "PATCH", {
      config: { locationConfig: locationConfig(["eu-central", "us-east"]) },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("us-east"),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("PATCH rejects codes outside the project", async () => {
    findFirst.mockResolvedValue(existing("website"));
    const response = await call(PATCH, "PATCH", {
      config: { locationConfig: locationConfig(["nowhere"]) },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid location codes"),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("PATCH leaves HTTP monitors on probe-only regions untouched", async () => {
    findFirst.mockResolvedValue(existing("website"));
    const response = await call(PATCH, "PATCH", {
      config: { locationConfig: locationConfig(["eu-central", "us-east", "asia-pacific"]) },
    });
    expect(response.status).not.toBe(400);
    expect(update).toHaveBeenCalled();
  });

  it("PATCH allows a status-only update on a synthetic monitor with a stale saved selection", async () => {
    findFirst.mockResolvedValue(
      existing("synthetic_test", { locationConfig: locationConfig(["us-east"]) }),
    );
    const response = await call(PATCH, "PATCH", { status: "paused" });
    expect(response.status).not.toBe(400);
  });

  it("PUT rejects switching to synthetic while probe-only regions are selected", async () => {
    findFirst.mockResolvedValue(
      existing("website", { locationConfig: locationConfig(["us-east", "asia-pacific"]) }),
    );
    const response = await call(PUT, "PUT", { type: "synthetic_test" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Browser checks are not available in"),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("PUT ignores an inert disabled location config", async () => {
    findFirst.mockResolvedValue(existing("synthetic_test"));
    const response = await call(PUT, "PUT", {
      config: { locationConfig: locationConfig(["us-east"], false) },
    });
    expect(response.status).not.toBe(400);
  });
});

it("PATCH applies CLI fields and refreshes the scheduler payload", async () => {
  jest.clearAllMocks();
  const original = { ...existing("http_request", { method: "GET", timeout: 30 }), frequencyMinutes: 5, enabled: true, status: "up", scheduledJobId: "old" };
  findFirst.mockResolvedValue(original);
  const changes = { target: "https://updated.example", type: "http_request", frequencyMinutes: 10, enabled: true, config: { method: "HEAD" } };
  const saved = { ...original, ...changes, config: { ...original.config, ...changes.config } };
  update.mockReturnValue({ set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), returning: jest.fn().mockResolvedValue([saved]) });
  const response = await call(PATCH, "PATCH", changes);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject(saved);
  const { scheduleMonitor } = await import("@/lib/monitor-scheduler");
  expect(scheduleMonitor).toHaveBeenCalledWith(expect.objectContaining({ frequencyMinutes: 10, jobData: expect.objectContaining({ target: changes.target, config: saved.config }) }));
});

describe("malformed monitor id versus permission", () => {
  const { checkPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as {
    checkPermissionWithContext: jest.Mock;
  };
  const malformed = { params: Promise.resolve({ id: "not-a-uuid" }) };
  const url = "http://localhost/api/monitors/not-a-uuid";

  afterEach(() => checkPermissionWithContext.mockReturnValue(true));

  it("answers 403 to a caller without permission, as it does for a well-formed id", async () => {
    checkPermissionWithContext.mockReturnValue(false);
    const response = await DELETE(new NextRequest(url, { method: "DELETE" }), malformed);
    expect(response.status).toBe(403);
  });

  it("answers 404 to a permitted caller, without a database error", async () => {
    checkPermissionWithContext.mockReturnValue(true);
    const response = await DELETE(new NextRequest(url, { method: "DELETE" }), malformed);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Monitor not found" });
  });
});

