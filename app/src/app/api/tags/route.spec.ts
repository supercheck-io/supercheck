/** @jest-environment node */
const mockCheck = jest.fn();
const mockPending = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ at: mockPending() ? new Date() : null }] }) }) }) } }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "org-1", orgPendingDeletion: false, project: { id: "p", userRole: "org_owner" } })),
  requireUserAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "org-1" })),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => mockCheck(...a) }));
import { NextRequest } from "next/server";
import { POST } from "./route";

import { clearDeletionStateCache } from "@/lib/deletion/org-state";
beforeEach(() => clearDeletionStateCache());
const call = () => POST(new NextRequest("https://app.supercheck.io/api/tags", { method: "POST", body: JSON.stringify({ name: "x" }) }));

describe("a denied tag write", () => {
  it("names the pending deletion for an organization pending deletion", async () => {
    mockCheck.mockReturnValue(false);
    mockPending.mockReturnValue(true);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ORG_PENDING_DELETION" });
  });

  it("keeps the generic message otherwise", async () => {
    mockCheck.mockReturnValue(false);
    mockPending.mockReturnValue(false);
    const response = await call();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Insufficient permissions to create tags" });
  });
});
