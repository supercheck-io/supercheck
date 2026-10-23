/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    transaction: jest.fn(),
    query: {
      tests: { findFirst: jest.fn() },
      jobs: { findFirst: jest.fn() },
      monitors: { findFirst: jest.fn() },
    },
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/resource-deletion/job", () => ({ deleteJobWithContext: jest.fn() }));
jest.mock("@/lib/resource-deletion/monitor", () => ({ deleteMonitorWithContext: jest.fn() }));
jest.mock("@/lib/resource-deletion/run", () => ({ deleteRunWithContext: jest.fn() }));
jest.mock("@/lib/server-actions/update-job", () => ({ updateJob: jest.fn() }));
jest.mock("@/lib/monitor-service", () => ({ updateMonitorHandler: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ scheduleMonitor: jest.fn(), deleteScheduledMonitor: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));
jest.mock("@/lib/queue", () => ({}));

import { db } from "@/utils/db";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { deleteJobWithContext } from "@/lib/resource-deletion/job";
import { deleteMonitorWithContext } from "@/lib/resource-deletion/monitor";
import { deleteRunWithContext } from "@/lib/resource-deletion/run";
import { PUT as updateTest, PATCH as patchTest, DELETE as deleteTest } from "./tests/[id]/route";
import { PUT as updateJob, PATCH as patchJob, DELETE as deleteJob } from "./jobs/[id]/route";
import { PUT as updateMonitor, PATCH as patchMonitor, DELETE as deleteMonitor } from "./monitors/[id]/route";
import { DELETE as deleteRun } from "./runs/[runId]/route";
import { GET as listRuns } from "./runs/route";

const mutations = [
  ["tests", "PUT", updateTest],
  ["tests", "PATCH", patchTest],
  ["tests", "DELETE", deleteTest],
  ["jobs", "PUT", updateJob],
  ["jobs", "PATCH", patchJob],
  ["jobs", "DELETE", deleteJob],
  ["monitors", "PUT", updateMonitor],
  ["monitors", "PATCH", patchMonitor],
  ["monitors", "DELETE", deleteMonitor],
] as const;

describe("malformed resource identifiers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAuthContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1", project: { id: "project-1" },
    } as never);
    jest.mocked(isAuthError).mockReturnValue(false);
  });

  function expectNoDataAccess() {
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.query.tests.findFirst).not.toHaveBeenCalled();
    expect(db.query.jobs.findFirst).not.toHaveBeenCalled();
    expect(db.query.monitors.findFirst).not.toHaveBeenCalled();
    expect(deleteJobWithContext).not.toHaveBeenCalled();
    expect(deleteMonitorWithContext).not.toHaveBeenCalled();
    expect(deleteRunWithContext).not.toHaveBeenCalled();
  }

  it.each(mutations)("%s %s rejects a malformed ID before data access", async (resource, method, handler) => {
    const response = await handler(new NextRequest(`http://localhost/api/${resource}/bad`, {
      method, ...(method === "DELETE" ? {} : { body: "{}" }),
    }), { params: Promise.resolve({ id: "bad" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("not found") });
    expectNoDataAccess();
  });

  it.each(mutations)("%s %s still requires authentication", async (resource, method, handler) => {
    jest.mocked(requireAuthContext).mockRejectedValue(new Error("unauthenticated"));
    jest.mocked(isAuthError).mockReturnValue(true);
    const response = await handler(new NextRequest(`http://localhost/api/${resource}/bad`, {
      method, ...(method === "DELETE" ? {} : { body: "{}" }),
    }), { params: Promise.resolve({ id: "bad" }) });
    expect(response.status).toBe(401);
    expectNoDataAccess();
  });

  it("rejects a malformed run ID before deletion", async () => {
    const response = await deleteRun(new Request("http://localhost/api/runs/bad", { method: "DELETE" }), {
      params: Promise.resolve({ runId: "bad" }),
    });
    expect(response.status).toBe(404);
    expectNoDataAccess();
  });

  it.each(["bad", "", "00000000-0000-0000-0000-00000000000g"])("rejects a malformed jobId filter (%s)", async (jobId) => {
    const response = await listRuns(new NextRequest(`http://localhost/api/runs?jobId=${jobId}`));
    expect(response.status).toBe(404);
    expectNoDataAccess();
  });
});
