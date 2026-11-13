/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/lib/deletion/project", () => ({ listDeletedProjects: jest.fn() }));
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { listDeletedProjects } from "@/lib/deletion/project";
import { GET } from "./route";

describe("GET deleted projects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: "org1", isCliAuth: false });
    (listDeletedProjects as jest.Mock).mockResolvedValue([{ id: "p1", name: "Old" }]);
  });

  it("lists the active organization's restorable projects for owners and admins", async () => {
    for (const role of ["org_owner", "org_admin"]) {
      (getUserOrgRole as jest.Mock).mockResolvedValue(role);
      const response = await GET();
      expect(response.status).toBe(200);
      expect((await response.json()).projects).toEqual([{ id: "p1", name: "Old" }]);
    }
    expect(listDeletedProjects).toHaveBeenCalledWith("org1");
  });

  it("refuses other roles, CLI tokens and sessions without an organization", async () => {
    (getUserOrgRole as jest.Mock).mockResolvedValue("project_admin");
    expect((await GET()).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: "org1", isCliAuth: true });
    expect((await GET()).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1", organizationId: null, isCliAuth: false });
    expect((await GET()).status).toBe(400);
    expect(listDeletedProjects).not.toHaveBeenCalled();
  });
});
