/** @jest-environment node */
import { NextRequest } from "next/server";

const mockReturning = jest.fn();
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(async () => ({ userId: "u1", isCliAuth: false })), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(async () => "org_owner"), isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/utils/db", () => ({ db: { update: () => ({ set: () => ({ where: () => ({ returning: () => mockReturning() }) }) }) } }));
jest.mock("@/lib/deletion/org-state", () => ({
  isOrgPendingDeletion: jest.fn(async () => false),
  pendingDeletionResponse: jest.fn(() => new Response(JSON.stringify({ code: "ORG_PENDING_DELETION" }), { status: 403 })),
}));
jest.mock("@/lib/deletion/organization", () => ({ OrganizationMembershipChangedError: class extends Error {}, requestOrganizationDeletion: jest.fn() }));

import { isOrgPendingDeletion } from "@/lib/deletion/org-state";
import { PUT } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const put = () => PUT(new NextRequest(`https://app.supercheck.io/api/organizations/${ORG_ID}`, {
  method: "PUT", headers: { origin: "https://app.supercheck.io" }, body: JSON.stringify({ name: "Renamed" }),
}), { params: Promise.resolve({ id: ORG_ID }) });

describe("organization update while a deletion is requested", () => {
  beforeEach(() => jest.clearAllMocks());

  it("updates an active organization", async () => {
    mockReturning.mockResolvedValue([{ id: ORG_ID, name: "Renamed" }]);
    expect((await put()).status).toBe(200);
  });

  it("refuses with the pending code when the deletion committed after the first check", async () => {
    mockReturning.mockResolvedValue([]); // the UPDATE's non-pending predicate matched nothing
    (isOrgPendingDeletion as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const response = await put();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "ORG_PENDING_DELETION" });
  });

  it("answers 404 when the organization is gone", async () => {
    mockReturning.mockResolvedValue([]);
    expect((await put()).status).toBe(404);
  });
});
