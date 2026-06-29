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
  db: {},
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
import { requireProjectContext } from "./project-context";

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
});
