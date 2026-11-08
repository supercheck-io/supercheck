/** @jest-environment node */

import { NextRequest } from "next/server";
import { AdminAccessDeniedError } from "@/lib/admin-errors";

jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn(), logImpersonationEvent: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: jest.fn() }));
jest.mock("@/lib/user-avatar", () => ({ pruneAvatars: jest.fn() }));
jest.mock("@/lib/data-lifecycle-service", () => ({ getDataLifecycleService: jest.fn() }));
jest.mock("@/lib/job-scheduler", () => ({ initializeJobSchedulers: jest.fn(), cleanupJobScheduler: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ initializeMonitorSchedulers: jest.fn() }));
jest.mock("@/lib/organization-teardown", () => ({
  BillingCancellationError: class extends Error {},
  OrganizationMembershipChangedError: class extends Error {},
  StorageCleanupError: class extends Error {},
  deleteOrganizationCompletely: jest.fn(),
  soleMemberOrganizations: jest.fn(),
}));

import { GET as playgroundGet } from "./playground-cleanup/route";
import { POST as schedulerInit } from "./scheduler/init/route";
import { PUT as orgPut, DELETE as orgDelete } from "./organizations/[id]/route";
import { DELETE as userDelete, POST as userPost } from "./users/[id]/route";

const { requireAdmin } = jest.requireMock("@/lib/admin") as { requireAdmin: jest.Mock };
const ID = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (method: string) => new NextRequest(`http://localhost/api/admin/x/${ID}`, { method });

const calls: Array<[string, () => Promise<Response>]> = [
  ["playground-cleanup GET", () => playgroundGet()],
  ["scheduler/init POST", () => schedulerInit(req("POST"))],
  ["organizations/[id] PUT", () => orgPut(req("PUT"), ctx)],
  ["organizations/[id] DELETE", () => orgDelete(req("DELETE"), ctx)],
  ["users/[id] DELETE", () => userDelete(req("DELETE"), ctx)],
  ["users/[id] POST", () => userPost(req("POST"), ctx)],
];

describe.each(calls)("%s admin denial", (_name, call) => {
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("returns 401 for anonymous callers", async () => {
    requireAdmin.mockRejectedValue(new AdminAccessDeniedError(401));
    expect((await call()).status).toBe(401);
  });

  it("returns 403 for authenticated non-admins", async () => {
    requireAdmin.mockRejectedValue(new AdminAccessDeniedError());
    expect((await call()).status).toBe(403);
  });
});
