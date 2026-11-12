/** @jest-environment node */
import { NextRequest } from "next/server";

const mockRows: Array<{ at: Date | null }> = [];
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mockRows }) }) }) } }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn(async () => ({ userId: "u1" })),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  resolveProjectPermissionContext: jest.fn(async () => ({ organizationId: "org-1" })),
  checkPermissionWithContext: jest.fn(() => false),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/s3-proxy", () => ({ getS3Client: jest.fn() }));
jest.mock("@/lib/creators", () => ({ loadCreators: jest.fn() }));
jest.mock("@/lib/encryption", () => ({ encryptValue: jest.fn() }));

import { POST } from "./route";
import { clearDeletionStateCache } from "@/lib/deletion/org-state";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const call = () =>
  POST(new NextRequest("http://localhost/api/projects/x/variables", { method: "POST", body: "{}" }), {
    params: Promise.resolve({ id: PROJECT_ID }),
  });

beforeEach(() => { clearDeletionStateCache(); mockRows.length = 0; });

it("answers a denied write with ORG_PENDING_DELETION for a member of a pending organization", async () => {
  mockRows.push({ at: new Date() });
  const res = await call();
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe("ORG_PENDING_DELETION");
});

it("keeps the plain 403 when the organization is not pending", async () => {
  mockRows.push({ at: null });
  const res = await call();
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Insufficient permissions to create variables" });
});
