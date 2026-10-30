/** @jest-environment node */
import { NextRequest } from "next/server";

const mockUpdateJob = jest.fn();
jest.mock("@/lib/server-actions/update-job", () => ({ JOB_CONFLICT_ERROR: "conflict!", updateJob: (...a: unknown[]) => mockUpdateJob(...a) }));
jest.mock("@/utils/db", () => ({ db: { query: { jobs: { findFirst: jest.fn(async () => ({ id: "ok" })) } } } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p", name: "P", userRole: "admin" } })),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/resource-deletion/job", () => ({ deleteJobWithContext: jest.fn() }));

import { PATCH, PUT } from "./route";

it("PUT applies the update to the job in the URL even if the body carries another jobId", async () => {
  mockUpdateJob.mockResolvedValue({ success: true, job: {} });
  const urlId = "018f0000-0000-7000-8000-000000000001";
  const req = new NextRequest(`http://localhost/api/jobs/${urlId}`, { method: "PUT", body: JSON.stringify({ jobId: "018f0000-0000-7000-8000-000000000002", name: "x" }) });
  await PUT(req, { params: Promise.resolve({ id: urlId }) });
  expect(mockUpdateJob.mock.calls[0][0].jobId).toBe(urlId);
});

it("PUT answers 409 for a stale update and 400 for other failures", async () => {
  const urlId = "018f0000-0000-7000-8000-000000000001";
  const call = () => PUT(new NextRequest(`http://localhost/api/jobs/${urlId}`, { method: "PUT", body: JSON.stringify({ name: "x" }) }), { params: Promise.resolve({ id: urlId }) });
  mockUpdateJob.mockResolvedValueOnce({ success: false, message: "conflict!" });
  expect((await call()).status).toBe(409);
  mockUpdateJob.mockResolvedValueOnce({ success: false, message: "invalid" });
  expect((await call()).status).toBe(400);
});

it("PATCH forwards neither stored tests nor a stored description it was not given", async () => {
  mockUpdateJob.mockResolvedValue({ success: true, job: {} });
  const urlId = "018f0000-0000-7000-8000-000000000001";
  await PATCH(new NextRequest(`http://localhost/api/jobs/${urlId}`, { method: "PATCH", body: JSON.stringify({ name: "renamed" }) }), { params: Promise.resolve({ id: urlId }) });
  const [data, ctx] = mockUpdateJob.mock.calls.at(-1)!;
  expect(data.tests).toBeUndefined();
  expect(ctx.inherited.description).toBe(true);
});
