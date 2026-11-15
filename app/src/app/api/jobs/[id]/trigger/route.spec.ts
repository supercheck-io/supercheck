/** @jest-environment node */
import { NextRequest } from "next/server";

const JOB_ID = "00000000-0000-4000-8000-0000000000aa";
const keyRow = { id: "k1", name: "key", key: "h", enabled: true, expiresAt: null, jobId: JOB_ID, userId: "u1", banned: false, banExpires: null };
const jobRow = { id: JOB_ID, name: "J", status: "active", organizationId: "org", projectId: "proj", jobType: "playwright" };
let selects: unknown[][] = [];
jest.mock("@/utils/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "where", "limit"]) c[m] = () => c;
    c.then = (res: (v: unknown[]) => unknown) => Promise.resolve(rows()).then(res);
    return c;
  };
  return {
    db: {
      select: jest.fn(() => chain(() => selects.shift() ?? [])),
      insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
      update: jest.fn(() => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) })),
    },
  };
});
jest.mock("@/lib/queue", () => ({ addJobToQueue: jest.fn(), addK6JobToQueue: jest.fn(), assertExecutionQueueReady: jest.fn() }));
jest.mock("@/lib/job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn().mockResolvedValue({ testScripts: [{ id: "t", script: "s", type: "agent" }], variableResolution: { variables: {}, secrets: {}, files: {} } }),
}));
jest.mock("@/lib/k6-validator", () => ({ validateK6Script: jest.fn() }));
jest.mock("@/lib/execution/execution-policy", () => ({ ExecutionWorkloadError: class extends Error {}, getExecutionPolicy: jest.fn().mockResolvedValue({ tier: "free" }) }));
jest.mock("@/lib/services/polar-usage.service", () => ({ polarUsageService: { shouldBlockUsage: jest.fn() } }));
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true }) },
  parseRateLimitConfig: jest.fn(),
  createRateLimitHeaders: jest.fn(),
}));
jest.mock("@/lib/security/api-key-hash", () => ({ hashApiKey: () => "h" }));
jest.mock("@/lib/security/credential-owner", () => ({ isCredentialOwnerActive: () => true }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: jest.fn(), isAuthError: () => false, authErrorStatus: () => 401 }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(), hasPermissionForUser: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/location-registry", () => ({
  assertProjectSupportsBrowser: jest.fn().mockResolvedValue(undefined),
  resolveProjectK6Location: jest.fn(),
  LocationWorkloadUnavailableError: class extends Error {},
}));
jest.mock("@/lib/deletion/org-state", () => ({
  isOrgPendingDeletion: jest.fn().mockResolvedValue(false),
  pendingDeletionResponse: jest.fn(),
  permissionDeniedResponse: jest.fn(),
}));

import { POST } from "./route";
import { addJobToQueue } from "@/lib/queue";
import { ExecutionQueueError } from "@/lib/execution-errors";

it("answers 503 AGENT_WORKERS_PENDING with Retry-After and fails the run when the queue gate refuses an agent test", async () => {
  selects = [[keyRow], [jobRow]];
  (addJobToQueue as jest.Mock).mockRejectedValueOnce(new ExecutionQueueError("agent_workers_pending", "pending"));
  const res = await POST(
    new NextRequest(`http://localhost/api/jobs/${JOB_ID}/trigger`, { method: "POST", headers: { authorization: "Bearer sk_test_0123456789" } }),
    { params: Promise.resolve({ id: JOB_ID }) },
  );
  expect(res.status).toBe(503);
  expect(res.headers.get("Retry-After")).toBeTruthy();
  expect((await res.json()).code).toBe("AGENT_WORKERS_PENDING");
});
