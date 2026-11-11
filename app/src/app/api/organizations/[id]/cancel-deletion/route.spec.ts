/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn(), isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/deletion/organization", () => {
  class OrganizationDeletionError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
  }
  return { OrganizationDeletionError, cancelOrganizationDeletion: jest.fn() };
});
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole, isImpersonatedSession } from "@/lib/rbac/middleware";
import { cancelOrganizationDeletion } from "@/lib/deletion/organization";
import { POST } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const params = { params: Promise.resolve({ id: ORG_ID }) };
const call = (origin = "https://app.supercheck.io") =>
  POST(new NextRequest(`https://app.supercheck.io/api/organizations/${ORG_ID}/cancel-deletion`, { method: "POST", headers: { origin } }), params);

describe("cancel organization deletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (cancelOrganizationDeletion as jest.Mock).mockResolvedValue({ billing: "reinstated" });
  });

  it("lets the owner cancel and reports what happened to billing", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, billing: "reinstated" });
    expect(cancelOrganizationDeletion).toHaveBeenCalledWith({ organizationId: ORG_ID, actorUserId: "owner" });
  });

  it.each(["org_admin", "project_admin", "project_editor", "project_viewer"])("refuses %s", async (role) => {
    (getUserOrgRole as jest.Mock).mockResolvedValueOnce(role);
    expect((await call()).status).toBe(403);
    expect(cancelOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("answers 404 to a non-member, and refuses cross-origin, CLI tokens and impersonated sessions", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call("https://foreign.example")).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "owner", isCliAuth: true });
    expect((await call()).status).toBe(403);
    (isImpersonatedSession as jest.Mock).mockResolvedValueOnce(true);
    expect((await call()).status).toBe(403);
    expect(cancelOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("surfaces PURGE_STARTED once the window is over", async () => {
    const { OrganizationDeletionError } = jest.requireMock("@/lib/deletion/organization");
    (cancelOrganizationDeletion as jest.Mock).mockRejectedValueOnce(new OrganizationDeletionError("too late", 409, "PURGE_STARTED"));
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PURGE_STARTED" });
  });
});
