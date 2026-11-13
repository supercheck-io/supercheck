/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/deletion/organization", () => ({ getOrganizationDeletionState: jest.fn() }));
jest.mock("@/lib/deletion/reauth", () => ({ reauthMaxAgeSeconds: () => 600 }));
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { getOrganizationDeletionState } from "@/lib/deletion/organization";
import { GET } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const get = (id = ORG_ID) => GET(new NextRequest(`https://app.supercheck.io/api/organizations/${id}/deletion`), { params: Promise.resolve({ id }) });
const state = { pending: true, requestedAt: new Date("2026-11-01T00:00:00Z"), purgeAfter: new Date("2026-11-15T00:00:00Z"), canCancel: true, purge: { state: "queued", phase: null }, graceDays: 14, emailAvailable: true, selfHosted: false, hasSubscription: false };

describe("GET organization deletion state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("project_viewer");
    (getOrganizationDeletionState as jest.Mock).mockResolvedValue(state);
  });

  it("gives any member the state with the sign-in age the cancel needs", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deletion).toMatchObject({ pending: true, canCancel: true, graceDays: 14, reauthMaxAgeSeconds: 600, purge: { state: "queued", phase: null } });
  });

  it("answers 404 to a non-member and to a malformed id, without reading state", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    expect(getOrganizationDeletionState).not.toHaveBeenCalled();
  });

  it("refuses CLI tokens", async () => {
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", isCliAuth: true });
    expect((await get()).status).toBe(403);
  });
});
