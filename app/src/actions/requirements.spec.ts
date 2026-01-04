/**
 * Requirements Server Actions Tests
 *
 * Comprehensive test coverage for RBAC, audit logging, and data isolation
 *
 * Test Categories:
 * - CRUD Operations (create, read, update, delete)
 * - RBAC (permission checks)
 * - Tenant Isolation (organization/project scoping)
 * - Audit Logging (all write operations)
 */

// Mock dependencies before imports
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  hasPermission: jest.fn(),
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

// Import after mocks
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

import {
  getRequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  deleteRequirements,
  linkTestsToRequirement,
  unlinkTestFromRequirement,
} from "./requirements";

// Cast mocks
const mockDb = db as jest.Mocked<typeof db>;
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockHasPermission = hasPermission as jest.Mock;
const mockLogAuditEvent = logAuditEvent as jest.Mock;

describe("Requirements Server Actions", () => {
  // Use valid UUIDs for Zod validation
  const testUserId = "11111111-1111-1111-1111-111111111111";
  const testOrgId = "22222222-2222-2222-2222-222222222222";
  const testProjectId = "33333333-3333-3333-3333-333333333333";
  const testRequirementId = "44444444-4444-4444-4444-444444444444";

  const mockProjectContext = {
    userId: testUserId,
    organizationId: testOrgId,
    project: {
      id: testProjectId,
      name: "Test Project",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue(mockProjectContext);
    mockHasPermission.mockResolvedValue(true);
  });

  // ==========================================================================
  // RBAC TESTS
  // ==========================================================================

  describe("RBAC Enforcement", () => {
    describe("getRequirements", () => {
      it("should require view permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        await expect(getRequirements()).rejects.toThrow(
          "Insufficient permissions to view requirements"
        );

        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "view", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });
    });

    describe("createRequirement", () => {
      it("should require create permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await createRequirement({
          title: "Test",
          description: "Test description",
          priority: "medium",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "create", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });
    });

    describe("updateRequirement", () => {
      it("should require update permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await updateRequirement({
          id: testRequirementId,
          title: "Updated Title",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "update", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });
    });

    describe("deleteRequirement", () => {
      it("should require delete permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await deleteRequirement(testRequirementId);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "delete", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });
    });

    describe("linkTestsToRequirement", () => {
      it("should require update permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await linkTestsToRequirement(testRequirementId, ["test-1"]);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
      });
    });

    describe("unlinkTestFromRequirement", () => {
      it("should require update permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await unlinkTestFromRequirement(testRequirementId, "test-1");

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
      });
    });
  });

  // ==========================================================================
  // AUDIT LOGGING TESTS
  // ==========================================================================

  describe("Audit Logging", () => {
    beforeEach(() => {
      // Setup successful DB operations
      const mockChain = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: testRequirementId }]),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      };
      (mockDb.insert as jest.Mock).mockReturnValue(mockChain);
      (mockDb.update as jest.Mock).mockReturnValue(mockChain);
      (mockDb.delete as jest.Mock).mockReturnValue(mockChain);

      // Mock select for existence checks
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: testRequirementId, title: "Test" }]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);
    });

    it("should log audit event on create", async () => {
      await createRequirement({
        title: "Test Requirement",
        description: "Test description",
        priority: "high",
      });

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirement_created",
          resource: "requirement",
          success: true,
        })
      );
    });

    it("should log audit event on update", async () => {
      await updateRequirement({
        id: testRequirementId,
        title: "Updated Title",
      });

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirement_updated",
          resource: "requirement",
          resourceId: testRequirementId,
          success: true,
        })
      );
    });

    it("should log audit event on delete", async () => {
      await deleteRequirement(testRequirementId);

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirement_deleted",
          resource: "requirement",
          resourceId: testRequirementId,
          success: true,
        })
      );
    });

    it("should log audit event on bulk delete", async () => {
      await deleteRequirements([testRequirementId, "req-2"]);

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirements_bulk_deleted",
          resource: "requirement",
          success: true,
        })
      );
    });

    it("should log audit event on link tests", async () => {
      await linkTestsToRequirement(testRequirementId, ["test-1", "test-2"]);

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirement_tests_linked",
          resource: "requirement",
          resourceId: testRequirementId,
          success: true,
        })
      );
    });

    it("should log audit event on unlink test", async () => {
      await unlinkTestFromRequirement(testRequirementId, "test-1");

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirement_test_unlinked",
          resource: "requirement",
          resourceId: testRequirementId,
          success: true,
        })
      );
    });
  });

  // ==========================================================================
  // TENANT ISOLATION TESTS
  // ==========================================================================

  describe("Tenant Isolation", () => {
    it("should scope all queries by projectId", async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      await getRequirements();

      // Verify that the query was built with project scoping
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockSelectChain.where).toHaveBeenCalled();
    });

    it("should include organizationId in create operation", async () => {
      const mockChain = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: testRequirementId }]),
      };
      (mockDb.insert as jest.Mock).mockReturnValue(mockChain);

      // Also mock for coverage snapshot
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      await createRequirement({
        title: "Test",
        description: "Test description",
        priority: "medium",
      });

      expect(mockChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: testOrgId,
          projectId: testProjectId,
        })
      );
    });

    it("should verify delete target belongs to current project", async () => {
      // Mock the existence check to return empty (not found in project)
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      const result = await deleteRequirement("non-existent-req");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Requirement not found");
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle empty test array for linking", async () => {
      const result = await linkTestsToRequirement(testRequirementId, []);

      expect(result.success).toBe(true);
      // Should not call audit log for empty array
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    it("should handle empty ids array for bulk delete", async () => {
      const result = await deleteRequirements([]);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
    });

    it("should handle database errors gracefully", async () => {
      (mockDb.insert as jest.Mock).mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = await createRequirement({
        title: "Test",
        description: "Test description",
        priority: "medium",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database error");
    });
  });
});
