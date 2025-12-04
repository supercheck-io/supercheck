/**
 * RBAC Middleware Tests
 *
 * Comprehensive test coverage for permission checking and enforcement
 *
 * Test Categories:
 * - Role Retrieval (getUserRole, getUserOrgRole)
 * - Variable Permissions (organization-aware)
 * - Helper Functions
 * - Security (project isolation, organization scope)
 * - Edge Cases (missing data, special characters)
 */

// Mock Next.js server before any imports
jest.mock("next/server", () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: jest.fn((body, init) => ({
      status: init?.status || 200,
      json: async () => body,
    })),
  },
}));

// Mock dependencies before imports
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    query: {
      organization: { findFirst: jest.fn() },
    },
  },
}));

jest.mock("@/utils/auth", () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));

jest.mock("./permissions", () => ({
  hasPermission: jest.fn().mockReturnValue(true),
  Role: {
    SUPER_ADMIN: "SUPER_ADMIN",
    ORG_OWNER: "ORG_OWNER",
    ORG_ADMIN: "ORG_ADMIN",
    PROJECT_ADMIN: "PROJECT_ADMIN",
    PROJECT_EDITOR: "PROJECT_EDITOR",
    PROJECT_VIEWER: "PROJECT_VIEWER",
  },
  statement: {
    organization: {},
    project: {},
    test: {},
    job: {},
    monitor: {},
    variable: {},
    apiKey: {},
    system: {},
  },
}));

jest.mock("./role-normalizer", () => ({
  normalizeRole: jest.fn(),
}));

jest.mock("./super-admin", () => ({
  isSuperAdmin: jest.fn(),
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

// Import after mocks
import { db } from "@/utils/db";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { Role } from "./permissions";
import { normalizeRole } from "./role-normalizer";
import { isSuperAdmin } from "./super-admin";

import {
  requireAuth,
  requireSuperAdmin,
  getUserRole,
  getUserOrgRole,
  getUserAssignedProjects,
  buildPermissionContext,
  canCreateVariableInProject,
  canUpdateVariableInProject,
  canDeleteVariableInProject,
  canViewSecretVariableInProject,
  getProjectIdFromUrl,
} from "./middleware";

// Cast mocks - use explicit jest.Mock for deeply nested mocks
const mockAuthGetSession = auth.api.getSession as unknown as jest.Mock;
const mockHeaders = headers as jest.Mock;
const mockNormalizeRole = normalizeRole as jest.Mock;
const mockIsSuperAdmin = isSuperAdmin as jest.Mock;
const mockDbSelect = db.select as jest.Mock;

// Type for NextRequest mock
type MockNextRequest = {
  url: string;
  method: string;
  headers: { get: (name: string) => string | null };
};

describe("RBAC Middleware", () => {
  // Test data fixtures
  const testUserId = "user-test-123";
  const testOrgId = "org-test-456";
  const testProjectId = "project-test-789";

  const mockSession = {
    user: {
      id: testUserId,
      name: "Test User",
      email: "test@example.com",
      image: null,
      role: "member",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockMemberRecord = {
    role: "admin",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockHeaders.mockResolvedValue({});
    mockAuthGetSession.mockResolvedValue(mockSession);
    mockIsSuperAdmin.mockResolvedValue(false);
    mockNormalizeRole.mockReturnValue(Role.ORG_ADMIN);

    // Default db mocks
    const mockSelectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mockMemberRecord]),
    };
    mockDbSelect.mockReturnValue(mockSelectChain as unknown);
  });

  // ==========================================================================
  // AUTHENTICATION TESTS
  // ==========================================================================

  describe("Authentication", () => {
    describe("requireAuth", () => {
      describe("Positive Cases", () => {
        it("should return user info when authenticated", async () => {
          const result = await requireAuth();

          expect(result.userId).toBe(testUserId);
          expect(result.user.email).toBe("test@example.com");
        });

        it("should return all user properties", async () => {
          const result = await requireAuth();

          expect(result.user.name).toBe("Test User");
          expect(result.user.emailVerified).toBe(true);
        });
      });

      describe("Negative Cases", () => {
        it("should throw when not authenticated", async () => {
          mockAuthGetSession.mockResolvedValue(null);

          await expect(requireAuth()).rejects.toThrow(
            "Authentication required"
          );
        });

        it("should throw on session error", async () => {
          mockAuthGetSession.mockRejectedValue(new Error("Session error"));

          await expect(requireAuth()).rejects.toThrow("Session error");
        });
      });
    });

    describe("requireSuperAdmin", () => {
      describe("Positive Cases", () => {
        it("should return userId when user is super admin", async () => {
          mockIsSuperAdmin.mockResolvedValue(true);

          const result = await requireSuperAdmin();

          expect(result.userId).toBe(testUserId);
          expect(result.error).toBeUndefined();
        });
      });

      describe("Negative Cases", () => {
        it("should return error when not authenticated", async () => {
          mockAuthGetSession.mockResolvedValue(null);

          const result = await requireSuperAdmin();

          expect(result.userId).toBe("");
          expect(result.error).toBe("Authentication required");
        });

        it("should return error when not super admin", async () => {
          mockIsSuperAdmin.mockResolvedValue(false);

          const result = await requireSuperAdmin();

          expect(result.userId).toBe("");
          expect(result.error).toBe("Super admin privileges required");
        });

        it("should return error on exception", async () => {
          mockAuthGetSession.mockRejectedValue(new Error("Auth error"));

          const result = await requireSuperAdmin();

          expect(result.error).toBe("Authentication failed");
        });
      });

      describe("Security Cases", () => {
        it("should call isSuperAdmin with correct userId", async () => {
          mockIsSuperAdmin.mockResolvedValue(false);

          await requireSuperAdmin();

          expect(mockIsSuperAdmin).toHaveBeenCalledWith(testUserId);
        });
      });
    });
  });

  // ==========================================================================
  // ROLE RETRIEVAL TESTS
  // ==========================================================================

  describe("Role Retrieval", () => {
    describe("getUserRole", () => {
      describe("Positive Cases", () => {
        it("should return SUPER_ADMIN for super admins", async () => {
          mockIsSuperAdmin.mockResolvedValue(true);

          const result = await getUserRole(testUserId);

          expect(result).toBe(Role.SUPER_ADMIN);
        });

        it("should return org role when organizationId provided", async () => {
          mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

          const result = await getUserRole(testUserId, testOrgId);

          expect(result).toBe(Role.ORG_OWNER);
        });

        it("should return PROJECT_VIEWER as default", async () => {
          mockIsSuperAdmin.mockResolvedValue(false);
          const mockSelectChain = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
          };
          mockDbSelect.mockReturnValue(mockSelectChain as unknown);

          const result = await getUserRole(testUserId, testOrgId);

          expect(result).toBe(Role.PROJECT_VIEWER);
        });
      });

      describe("Edge Cases", () => {
        it("should check super admin first", async () => {
          mockIsSuperAdmin.mockResolvedValue(true);

          await getUserRole(testUserId, testOrgId);

          // Should not query org role if super admin
          expect(mockIsSuperAdmin).toHaveBeenCalled();
        });

        it("should handle undefined organizationId", async () => {
          mockIsSuperAdmin.mockResolvedValue(false);

          const result = await getUserRole(testUserId);

          expect(result).toBe(Role.PROJECT_VIEWER);
        });
      });
    });

    describe("getUserOrgRole", () => {
      describe("Positive Cases", () => {
        it("should return normalized role from member record", async () => {
          mockNormalizeRole.mockReturnValue(Role.ORG_ADMIN);

          const result = await getUserOrgRole(testUserId, testOrgId);

          expect(result).toBe(Role.ORG_ADMIN);
          expect(mockNormalizeRole).toHaveBeenCalledWith("admin");
        });

        it("should query database for member record", async () => {
          await getUserOrgRole(testUserId, testOrgId);

          expect(mockDbSelect).toHaveBeenCalled();
        });
      });

      describe("Negative Cases", () => {
        it("should return null when no member record found", async () => {
          const mockSelectChain = {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
          };
          mockDbSelect.mockReturnValue(mockSelectChain as unknown);

          const result = await getUserOrgRole(testUserId, testOrgId);

          expect(result).toBeNull();
        });
      });

      describe("Security Cases", () => {
        it("should only return role for specific user and org", async () => {
          await getUserOrgRole(testUserId, testOrgId);

          expect(mockDbSelect).toHaveBeenCalled();
        });
      });
    });

    describe("getUserAssignedProjects", () => {
      it("should return array of project IDs", async () => {
        const mockProjects = [
          { projectId: "proj-1" },
          { projectId: "proj-2" },
          { projectId: "proj-3" },
        ];
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockProjects),
        } as unknown);

        const result = await getUserAssignedProjects(testUserId);

        expect(result).toEqual(["proj-1", "proj-2", "proj-3"]);
      });

      it("should return empty array when no projects assigned", async () => {
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        } as unknown);

        const result = await getUserAssignedProjects(testUserId);

        expect(result).toEqual([]);
      });

      it("should handle large number of projects", async () => {
        const mockProjects = Array.from({ length: 100 }, (_, i) => ({
          projectId: `proj-${i}`,
        }));
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockProjects),
        } as unknown);

        const result = await getUserAssignedProjects(testUserId);

        expect(result).toHaveLength(100);
      });
    });

    describe("buildPermissionContext", () => {
      it("should build complete context", async () => {
        // For PROJECT_EDITOR, it also queries assigned projects
        mockNormalizeRole.mockReturnValue(Role.PROJECT_EDITOR);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call: getUserOrgRole
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue([mockMemberRecord]),
            } as unknown;
          }
          // Second call: getUserAssignedProjects
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue([{ projectId: "proj-1" }]),
          } as unknown;
        });

        const result = await buildPermissionContext(
          testUserId,
          testOrgId,
          testProjectId
        );

        expect(result.userId).toBe(testUserId);
        expect(result.organizationId).toBe(testOrgId);
        expect(result.projectId).toBe(testProjectId);
        expect(result.role).toBeDefined();
      });

      it("should include assigned projects for editors", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_EDITOR);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue([{ role: "editor" }]),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockResolvedValue([{ projectId: "proj-1" }]),
          } as unknown;
        });

        const result = await buildPermissionContext(testUserId, testOrgId);

        expect(result.assignedProjectIds).toContain("proj-1");
      });

      it("should return empty assignedProjectIds for non-editors", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);
        const mockSelectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([{ role: "owner" }]),
        };
        mockDbSelect.mockReturnValue(mockSelectChain as unknown);

        const result = await buildPermissionContext(testUserId, testOrgId);

        expect(result.assignedProjectIds).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // ORGANIZATION-AWARE VARIABLE PERMISSIONS
  // ==========================================================================

  describe("Organization-Aware Variable Permissions", () => {
    const mockProject = [{ id: testProjectId, organizationId: testOrgId }];

    beforeEach(() => {
      // Setup project lookup
      mockDbSelect.mockImplementation(
        () =>
          ({
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue(mockProject),
          }) as unknown
      );
    });

    describe("canCreateVariableInProject", () => {
      it("should allow ORG_OWNER to create in any project", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow ORG_ADMIN to create in any project", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_ADMIN);

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow PROJECT_ADMIN to create", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_ADMIN }]),
          } as unknown;
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow PROJECT_EDITOR to create", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_EDITOR }]),
          } as unknown;
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should deny PROJECT_VIEWER from creating", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_VIEWER }]),
          } as unknown;
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });

      it("should return false when project not found", async () => {
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        } as unknown);

        const result = await canCreateVariableInProject(
          testUserId,
          "non-existent"
        );

        expect(result).toBe(false);
      });

      it("should return false when user not a project member", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
          } as unknown;
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });

      it("should return false on error", async () => {
        mockDbSelect.mockImplementation(() => {
          throw new Error("Database error");
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });
    });

    describe("canUpdateVariableInProject", () => {
      it("should allow ORG_OWNER to update", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

        const result = await canUpdateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow PROJECT_EDITOR to update", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_EDITOR }]),
          } as unknown;
        });

        const result = await canUpdateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should deny PROJECT_VIEWER from updating", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_VIEWER }]),
          } as unknown;
        });

        const result = await canUpdateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });
    });

    describe("canDeleteVariableInProject", () => {
      it("should allow ORG_OWNER to delete", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

        const result = await canDeleteVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow PROJECT_ADMIN to delete", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_ADMIN }]),
          } as unknown;
        });

        const result = await canDeleteVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should deny PROJECT_EDITOR from deleting", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_EDITOR }]),
          } as unknown;
        });

        const result = await canDeleteVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });
    });

    describe("canViewSecretVariableInProject", () => {
      it("should allow ORG_ADMIN to view secrets", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_ADMIN);

        const result = await canViewSecretVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should allow PROJECT_EDITOR to view secrets", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_EDITOR }]),
          } as unknown;
        });

        const result = await canViewSecretVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should deny PROJECT_VIEWER from viewing secrets", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue(mockProject),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_VIEWER }]),
          } as unknown;
        });

        const result = await canViewSecretVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });
    });
  });

  // ==========================================================================
  // HELPER FUNCTION TESTS
  // ==========================================================================

  describe("Helper Functions", () => {
    describe("getProjectIdFromUrl", () => {
      it("should extract project ID from URL", () => {
        const req = {
          url: "http://localhost/api/projects/proj-123/tests",
        } as MockNextRequest;

        const result = getProjectIdFromUrl(req as unknown as NextRequest);

        expect(result).toBe("proj-123");
      });

      it("should return null when no project ID in URL", () => {
        const req = {
          url: "http://localhost/api/users",
        } as MockNextRequest;

        const result = getProjectIdFromUrl(req as unknown as NextRequest);

        expect(result).toBeNull();
      });

      it("should handle URL with project at end", () => {
        const req = {
          url: "http://localhost/api/projects/proj-456",
        } as MockNextRequest;

        const result = getProjectIdFromUrl(req as unknown as NextRequest);

        expect(result).toBe("proj-456");
      });

      it("should handle deeply nested URL", () => {
        const req = {
          url: "http://localhost/api/v1/org/123/projects/proj-789/tests/results",
        } as MockNextRequest;

        const result = getProjectIdFromUrl(req as unknown as NextRequest);

        expect(result).toBe("proj-789");
      });

      it("should return first project ID if multiple in URL", () => {
        const req = {
          url: "http://localhost/api/projects/proj-1/subprojects/proj-2",
        } as MockNextRequest;

        const result = getProjectIdFromUrl(req as unknown as NextRequest);

        // Returns first one after 'projects'
        expect(result).toBe("proj-1");
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe("Security", () => {
    describe("Project Isolation", () => {
      it("should not allow access to unassigned projects", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        } as unknown);

        const result = await canCreateVariableInProject(
          testUserId,
          "other-project"
        );

        expect(result).toBe(false);
      });

      it("should verify project exists before checking permissions", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        } as unknown);

        const result = await canCreateVariableInProject(
          testUserId,
          "non-existent"
        );

        expect(result).toBe(false);
      });
    });

    describe("Organization Scope", () => {
      it("should validate organization membership", async () => {
        const mockSelectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        };
        mockDbSelect.mockReturnValue(mockSelectChain as unknown);

        const result = await getUserOrgRole(testUserId, "other-org");

        expect(result).toBeNull();
      });
    });

    describe("Super Admin Validation", () => {
      it("should properly verify super admin status", async () => {
        mockIsSuperAdmin.mockResolvedValue(false);

        const result = await requireSuperAdmin();

        expect(result.error).toBe("Super admin privileges required");
        expect(mockIsSuperAdmin).toHaveBeenCalledWith(testUserId);
      });

      it("should grant super admin immediate access", async () => {
        mockIsSuperAdmin.mockResolvedValue(true);

        const role = await getUserRole(testUserId, testOrgId);

        expect(role).toBe(Role.SUPER_ADMIN);
        // Should not check org role since super admin
      });
    });

    describe("Role Hierarchy", () => {
      it("should recognize ORG_OWNER as highest org role", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

        const result = await canDeleteVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });

      it("should recognize PROJECT_ADMIN can delete in projects", async () => {
        mockNormalizeRole.mockReturnValue(Role.PROJECT_VIEWER);
        let callCount = 0;
        mockDbSelect.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest
                .fn()
                .mockResolvedValue([
                  { id: testProjectId, organizationId: testOrgId },
                ]),
            } as unknown;
          }
          return {
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([{ role: Role.PROJECT_ADMIN }]),
          } as unknown;
        });

        const result = await canDeleteVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(true);
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge Cases", () => {
    describe("Missing Data", () => {
      it("should handle missing session user", async () => {
        mockAuthGetSession.mockResolvedValue({ user: null });

        await expect(requireAuth()).rejects.toThrow();
      });

      it("should handle empty organization ID", async () => {
        await getUserOrgRole(testUserId, "");

        // Should still make the query
        expect(mockDbSelect).toHaveBeenCalled();
      });

      it("should handle empty project ID", async () => {
        mockDbSelect.mockReturnValue({
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        } as unknown);

        const result = await canCreateVariableInProject(testUserId, "");

        expect(result).toBe(false);
      });
    });

    describe("Special Characters", () => {
      it("should handle special characters in user ID", async () => {
        const specialUserId = "user-test-special";
        mockIsSuperAdmin.mockResolvedValue(false);

        const result = await getUserRole(specialUserId);

        expect(result).toBeDefined();
      });

      it("should handle UUID-style IDs", async () => {
        const uuidUserId = "550e8400-e29b-41d4-a716-446655440000";
        mockIsSuperAdmin.mockResolvedValue(false);

        const result = await getUserRole(uuidUserId);

        expect(result).toBeDefined();
      });
    });

    describe("Concurrent Access", () => {
      it("should handle concurrent role lookups", async () => {
        mockIsSuperAdmin.mockResolvedValue(false);

        const promise1 = getUserRole(testUserId, testOrgId);
        const promise2 = getUserRole(testUserId, testOrgId);

        const [result1, result2] = await Promise.all([promise1, promise2]);

        expect(result1).toBeDefined();
        expect(result2).toBeDefined();
      });

      it("should handle concurrent permission checks", async () => {
        mockNormalizeRole.mockReturnValue(Role.ORG_OWNER);

        const promises = Array.from({ length: 5 }, () =>
          canCreateVariableInProject(testUserId, testProjectId)
        );

        const results = await Promise.all(promises);

        expect(results.every((r) => r === true)).toBe(true);
      });
    });

    describe("Error Recovery", () => {
      it("should return false on database error in variable permission check", async () => {
        mockDbSelect.mockImplementation(() => {
          throw new Error("Database unavailable");
        });

        const result = await canCreateVariableInProject(
          testUserId,
          testProjectId
        );

        expect(result).toBe(false);
      });
    });
  });
});
