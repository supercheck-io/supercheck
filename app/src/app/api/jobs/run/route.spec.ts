/** @jest-environment node */

import { NextRequest } from "next/server";
import { jobs, jobTests, tests } from "@/db/schema";

const tables: Record<string, unknown[]> = {};
const rowsFor = (t: unknown) =>
  t === jobs ? tables.jobs : t === jobTests ? tables.jobTests : t === tests ? tables.tests : [];

jest.mock("@/utils/db", () => {
  // Chainable query: awaitable at any point, resolves to the rows of the table passed to from().
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res),
    };
    return c;
  };
  return {
    db: {
      select: jest.fn(() => ({ from: (t: unknown) => chain(rowsFor(t)) })),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
      update: jest.fn(() => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) })),
    },
  };
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({
    userId: "u1", organizationId: "org-1", project: { id: "p1", name: "P" }, isCliAuth: true,
  }),
  isAuthError: jest.fn().mockReturnValue(false),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn().mockReturnValue(true) }));
jest.mock("@/lib/queue", () => ({ addJobToQueue: jest.fn().mockResolvedValue({ status: "queued" }), addK6JobToQueue: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/k6-validator", () => ({ validateK6Script: jest.fn() }));
jest.mock("@/lib/job-execution-utils", () => ({
  decodeTestScript: jest.fn(async (s: string) => s),
  applyVariablesToTestScripts: jest.fn(async (scripts: unknown[]) => ({
    processedTestScripts: scripts,
    variableResolution: { variables: {}, secrets: {}, files: {} },
  })),
}));
jest.mock("@/lib/execution/execution-policy", () => ({
  getExecutionPolicy: jest.fn().mockResolvedValue({ tier: "free" }),
}));
jest.mock("@/lib/services/polar-usage.service", () => ({ polarUsageService: { shouldBlockUsage: jest.fn() } }));
jest.mock("@/lib/location-registry", () => ({
  assertProjectSupportsBrowser: jest.fn().mockResolvedValue(undefined),
  resolveProjectK6Location: jest.fn(),
  LocationWorkloadUnavailableError: class extends Error {},
}));
jest.mock("@/lib/execution-rate-limiter", () => ({ checkExecutionRateLimit: jest.fn().mockResolvedValue({ allowed: true }) }));

import { POST } from "./route";
import { addJobToQueue } from "@/lib/queue";

describe("POST /api/jobs/run", () => {
  it("runs the job's saved tests, not the caller-supplied ids", async () => {
    tables.jobs = [{ organizationId: "org-1", projectId: "p1", jobType: "playwright", name: "J" }];
    tables.jobTests = [{ id: "saved-test" }];
    // The tests lookup returns one row regardless of the id asked for; the id sent must be the saved one.
    tables.tests = [{ id: "saved-test", title: "Saved", script: "saved-script", type: "browser" }];

    const res = await POST(
      new NextRequest("http://localhost/api/jobs/run", {
        method: "POST",
        body: JSON.stringify({ jobId: "j1", trigger: "manual", tests: [{ id: "attacker-test" }, { id: "attacker-test" }] }),
      }),
    );

    expect(res.status).toBe(200);
    const task = (addJobToQueue as jest.Mock).mock.calls[0][0];
    expect(task.testScripts.map((t: { id: string }) => t.id)).toEqual(["saved-test"]);
  });
});
