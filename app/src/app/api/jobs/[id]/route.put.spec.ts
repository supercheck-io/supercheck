/** @jest-environment node */
import { NextRequest } from "next/server";

const mockUpdateJob = jest.fn();
jest.mock("@/lib/server-actions/update-job", () => ({ updateJob: (...a: unknown[]) => mockUpdateJob(...a) }));
jest.mock("@/utils/db", () => ({ db: { query: { jobs: { findFirst: jest.fn(async () => ({ id: "ok" })) } } } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p", name: "P", userRole: "admin" } })),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/resource-deletion/job", () => ({ deleteJobWithContext: jest.fn() }));

import { PUT } from "./route";

it("PUT applies the update to the job in the URL even if the body carries another jobId", async () => {
  mockUpdateJob.mockResolvedValue({ success: true, job: {} });
  const urlId = "018f0000-0000-7000-8000-000000000001";
  const req = new NextRequest(`http://localhost/api/jobs/${urlId}`, { method: "PUT", body: JSON.stringify({ jobId: "018f0000-0000-7000-8000-000000000002", name: "x" }) });
  await PUT(req, { params: Promise.resolve({ id: urlId }) });
  expect(mockUpdateJob.mock.calls[0][0].jobId).toBe(urlId);
});
