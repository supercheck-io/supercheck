jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));

jest.mock("@/lib/session-cache", () => ({
  getCachedAuthSession: jest.fn(),
}));

jest.mock("./rbac/unified-auth", () => ({
  getUnifiedAuthContext: jest.fn(),
}));

jest.mock("@/utils/auth", () => ({
  auth: {},
}));

jest.mock("@/utils/db", () => ({
  db: { select: jest.fn(), update: jest.fn() },
}));

jest.mock("./session", () => ({
  getActiveOrganization: jest.fn(),
  getUserProjects: jest.fn(),
  getCurrentUser: jest.fn(),
}));

jest.mock("./rbac/middleware", () => ({
  getUserOrgRole: jest.fn(),
}));

jest.mock("./rbac/permissions", () => ({
  Role: {
    SUPER_ADMIN: "super_admin",
    ORG_OWNER: "org_owner",
    ORG_ADMIN: "org_admin",
    PROJECT_ADMIN: "project_admin",
    PROJECT_EDITOR: "project_editor",
    PROJECT_VIEWER: "project_viewer",
  },
}));

jest.mock("./rbac/role-normalizer", () => ({
  roleToString: jest.fn((role: string) => role),
}));

import { headers } from "next/headers";
import { getCachedAuthSession } from "@/lib/session-cache";
import { getUnifiedAuthContext } from "./rbac/unified-auth";
import { db } from "@/utils/db";
import { getActiveOrganization, getCurrentUser, getUserProjects } from "./session";
import { getCurrentProjectContext, requireProjectContext } from "./project-context";

const mockHeaders = headers as jest.Mock;
const mockGetCachedAuthSession = getCachedAuthSession as jest.Mock;
const mockGetUnifiedAuthContext = getUnifiedAuthContext as jest.Mock;

describe("requireProjectContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHeaders.mockResolvedValue({ get: jest.fn().mockReturnValue(null) });
    mockGetCachedAuthSession.mockResolvedValue({
      session: { token: "session-token" },
      user: { id: "user-1" },
    });
  });

  it("preserves super admin project context without organization membership", async () => {
    mockGetUnifiedAuthContext.mockResolvedValue({
      isValid: true,
      userId: "user-1",
      userEmail: "admin@example.com",
      impersonatedBy: null,
      projectId: "project-1",
      projectName: "Production",
      projectRole: "super_admin",
      isDefaultProject: true,
      organizationId: "org-1",
      organizationSlug: "acme",
      organizationRole: "super_admin",
      subscriptionStatus: null,
      polarCustomerId: null,
    });

    const context = await requireProjectContext();

    expect(context).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      project: {
        id: "project-1",
        name: "Production",
        slug: undefined,
        organizationId: "org-1",
        isDefault: true,
        userRole: "super_admin",
      },
    });
  });

  it.each(["project_admin", "project_editor", "project_viewer"])(
    "degrades unassigned organization role %s to project viewer",
    async (organizationRole) => {
      mockGetUnifiedAuthContext.mockResolvedValue({
        isValid: true,
        userId: "user-1",
        projectId: "project-a",
        projectName: "Project A",
        organizationId: "org-1",
        organizationRole,
        projectRole: null,
      });

      const context = await requireProjectContext();

      expect(context.project.userRole).toBe("project_viewer");
      expect(context.organizationId).toBe("org-1");
    },
  );
});


describe("default project recovery", () => {
  const set = jest.fn();
  const returning = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedAuthSession.mockResolvedValue({ session: { token: "session-token" }, user: { id: "user-1" } });
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
    (getActiveOrganization as jest.Mock).mockResolvedValue({ id: "org-b" });
    (getUserProjects as jest.Mock).mockResolvedValue([{ id: "project-b", name: "Project B", organizationId: "org-b", isDefault: true, role: "org_owner" }]);
    const rows = (values: unknown[]) => ({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(values) });
    (db.select as jest.Mock).mockReset().mockReturnValueOnce(rows([{ activeOrganizationId: "org-b", activeProjectId: "project-a", userId: "user-1" }]))
      .mockReturnValueOnce(rows([{ id: "project-a", organizationId: "org-a" }]));
    returning.mockResolvedValue([{ id: "session-id" }]);
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
    (db.update as jest.Mock).mockReturnValue({ set });
  });

  it("recovers a stale project using the selected organization's default", async () => {
    expect(await getCurrentProjectContext()).toMatchObject({ id: "project-b", organizationId: "org-b" });
    expect(set).toHaveBeenCalledWith({ activeOrganizationId: "org-b", activeProjectId: "project-b" });
  });

  it("returns no stale project when a newer selection wins the conditional update", async () => {
    returning.mockResolvedValue([]);
    expect(await getCurrentProjectContext()).toBeNull();
  });
});
