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
    transaction: jest.fn(),
  },
}));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

// Import after mocks
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
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
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;
const mockLogAuditEvent = logAuditEvent as jest.Mock;

describe("Requirements Server Actions", () => {
  // Use valid UUIDs for Zod validation
  const testUserId = "11111111-1111-4111-8111-111111111111";
  const testOrgId = "22222222-2222-4222-8222-222222222222";
  const testProjectId = "33333333-3333-4333-8333-333333333333";
  const testRequirementId = "44444444-4444-4444-8444-444444444444";
  const testIdA = "66666666-6666-4666-8666-666666666666";
  const testIdB = "77777777-7777-4777-8777-777777777777";
  const foreignTestId = "88888888-8888-4888-8888-888888888888";
  const foreignRequirementId = "99999999-9999-4999-8999-999999999999";

  const mockProjectContext = {
    userId: testUserId,
    organizationId: testOrgId,
    project: {
      id: testProjectId,
      name: "Test Project",
    },
  };


  // Queue results for successive db.select() calls (requirement scope check,
  // then test scope check). Each chain resolves for both `.where()` and `.limit()`.
  const mockSelectResults = (...results: unknown[][]) => {
    for (const rows of results) {
      (mockDb.select as jest.Mock).mockImplementationOnce(() => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve(rows);
            return Object.assign(p, { limit: () => Promise.resolve(rows) });
          },
        }),
      }));
    }
  };

  const mockWriteChains = () => {
    (mockDb.insert as jest.Mock).mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () =>
          Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: testRequirementId }]) }),
      }),
    }));
    (mockDb.update as jest.Mock).mockImplementation(() => ({
      set: () => ({ where: () => Promise.resolve() }),
    }));
    (mockDb.delete as jest.Mock).mockImplementation(() => ({
      where: () => Promise.resolve(),
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue(mockProjectContext);
    mockCheckPermissionWithContext.mockReturnValue(true);
    (mockDb.transaction as jest.Mock).mockImplementation(async (run: (tx: unknown) => unknown) => run(mockDb));
  });

  it("rejects an unavailable or foreign source document before creating a requirement", async () => {
    mockSelectResults([]);
    mockWriteChains();
    const result = await createRequirement({
      title: "Scoped source",
      sourceDocumentId: foreignRequirementId,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Source document not found in this project");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // RBAC TESTS
  // ==========================================================================

  describe("RBAC Enforcement", () => {
    describe("getRequirements", () => {
      it("should require view permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        await expect(getRequirements()).rejects.toThrow(
          "Insufficient permissions to view requirements"
        );

        expect(mockCheckPermissionWithContext).toHaveBeenCalledWith("requirement", "view", {
          userId: testUserId,
          organizationId: testOrgId,
          project: expect.objectContaining({ id: testProjectId }),
        });
      });
    });

    describe("createRequirement", () => {
      it("should require create permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        const result = await createRequirement({
          title: "Test",
          description: "Test description",
          priority: "medium",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockCheckPermissionWithContext).toHaveBeenCalledWith("requirement", "create", {
          userId: testUserId,
          organizationId: testOrgId,
          project: expect.objectContaining({ id: testProjectId }),
        });
      });
    });

    describe("updateRequirement", () => {
      it("should require update permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        const result = await updateRequirement({
          id: testRequirementId,
          title: "Updated Title",
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockCheckPermissionWithContext).toHaveBeenCalledWith("requirement", "update", {
          userId: testUserId,
          organizationId: testOrgId,
          project: expect.objectContaining({ id: testProjectId }),
        });
      });
    });

    describe("deleteRequirement", () => {
      it("should require delete permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        const result = await deleteRequirement(testRequirementId);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
        expect(mockCheckPermissionWithContext).toHaveBeenCalledWith("requirement", "delete", {
          userId: testUserId,
          organizationId: testOrgId,
          project: expect.objectContaining({ id: testProjectId }),
        });
      });
    });

    describe("linkTestsToRequirement", () => {
      it("should require update permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        const result = await linkTestsToRequirement(testRequirementId, [testIdA]);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Insufficient permissions");
      });
    });

    describe("unlinkTestFromRequirement", () => {
      it("should require update permission", async () => {
        mockCheckPermissionWithContext.mockReturnValue(false);

        const result = await unlinkTestFromRequirement(testRequirementId, testIdA);

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
        onConflictDoNothing: jest.fn().mockReturnThis(),
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
      mockWriteChains();
      mockSelectResults([{ id: testRequirementId }], [{ id: testIdA }, { id: testIdB }]);
      // updateCoverageSnapshot reads linked tests
      mockSelectResults([]);
      await linkTestsToRequirement(testRequirementId, [testIdA, testIdB]);

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
      mockWriteChains();
      mockSelectResults([{ id: testRequirementId }], [{ id: testIdA }]);
      mockSelectResults([]);
      await unlinkTestFromRequirement(testRequirementId, testIdA);

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

  describe("Test link scope enforcement", () => {
    it("rejects an update with tags from another project before writing anything", async () => {
      mockWriteChains();
      mockSelectResults([]);

      const result = await updateRequirement({
        id: testRequirementId,
        title: "Updated",
        tagIds: ["55555555-5555-4555-8555-555555555555"],
      });

      expect(result.success).toBe(false);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it("refuses to link tests to a requirement outside the caller's scope", async () => {
      mockWriteChains();
      mockSelectResults([]);

      const result = await linkTestsToRequirement(foreignRequirementId, [testIdA]);

      expect(result.success).toBe(false);
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    it("refuses to link tests outside the caller's scope", async () => {
      mockWriteChains();
      mockSelectResults([{ id: testRequirementId }], []);

      const result = await linkTestsToRequirement(testRequirementId, [foreignTestId]);

      expect(result.success).toBe(false);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("refuses to unlink from a requirement outside the caller's scope", async () => {
      mockWriteChains();
      mockSelectResults([]);

      const result = await unlinkTestFromRequirement(foreignRequirementId, testIdA);

      expect(result.success).toBe(false);
      expect(mockDb.delete).not.toHaveBeenCalled();
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
        onConflictDoNothing: jest.fn().mockReturnThis(),
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
  // ATOMIC AND IDEMPOTENT CREATE
  // ==========================================================================

  describe("createRequirement atomicity and retries", () => {
    const clientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    type Tx = { insert: jest.Mock };

    // A distinct transaction handle, so a write that bypasses it (and would survive a rollback) is detectable.
    const useTransaction = (insertResults: Array<() => unknown>) => {
      const tx: Tx = { insert: jest.fn() };
      for (const result of insertResults) {
        tx.insert.mockImplementationOnce(() => ({
          values: () => ({
            onConflictDoNothing: () => ({ returning: () => result() }),
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve().then(result).then(resolve, reject),
          }),
        }));
      }
      (mockDb.transaction as jest.Mock).mockImplementation(async (run: (t: Tx) => unknown) => run(tx));
      return tx;
    };

    it("writes the row and its coverage snapshot only through the transaction", async () => {
      const tx = useTransaction([() => Promise.resolve([{ id: clientId }]), () => Promise.resolve()]);

      const result = await createRequirement({ title: "Atomic", id: clientId });

      expect(result).toEqual({ id: clientId, success: true });
      expect(tx.insert).toHaveBeenCalledTimes(2);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("reports a failure after the row insert as not created, so a retry cannot duplicate it", async () => {
      useTransaction([() => Promise.resolve([{ id: clientId }]), () => Promise.reject(new Error("snapshot failed"))]);

      const result = await createRequirement({ title: "Atomic", id: clientId });

      expect(result).toMatchObject({ success: false, id: "" });
      expect(result.error).toContain("snapshot failed");
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    // The replay lookup, recording the condition it was given so the tenant scope can be asserted.
    const mockReplayLookup = (rows: unknown[]) => {
      const lookup: { where?: SQL } = {};
      (mockDb.select as jest.Mock).mockImplementationOnce(() => ({
        from: () => ({
          where: (condition: SQL) => {
            lookup.where = condition;
            return { limit: () => Promise.resolve(rows) };
          },
        }),
      }));
      return lookup;
    };

    it("treats a replay of the same id in this project as already created", async () => {
      const tx = useTransaction([() => Promise.resolve([])]);
      const lookup = mockReplayLookup([{ id: clientId }]);

      const result = await createRequirement({ title: "Atomic", id: clientId });

      expect(result).toEqual({ id: clientId, success: true });
      expect(tx.insert).toHaveBeenCalledTimes(1); // no second snapshot, no tags re-synced
      expect(mockLogAuditEvent).not.toHaveBeenCalled();

      // Success is only for the same tenant: the lookup is scoped to this org and project, not just the id.
      const { sql, params } = new PgDialect().sqlToQuery(lookup.where as SQL);
      expect(sql).toContain('"requirements"."organization_id" = $');
      expect(sql).toContain('"requirements"."project_id" = $');
      expect(params).toEqual(expect.arrayContaining([clientId, testOrgId, testProjectId]));
    });

    it("refuses an id that already belongs to another project instead of claiming it", async () => {
      useTransaction([() => Promise.resolve([])]);
      mockReplayLookup([]);

      const result = await createRequirement({ title: "Atomic", id: clientId });

      expect(result).toEqual({ id: "", success: false, error: "Requirement id is already in use" });
    });

    it("writes tags through the transaction as well, never through the shared pool", async () => {
      const rows = [{ id: clientId, name: "ai" }];
      const chain = (data: unknown): unknown =>
        Object.assign(Promise.resolve(data), {
          returning: () => Promise.resolve(data),
          onConflictDoNothing: () => chain(data),
        });
      const tx = {
        insert: jest.fn(() => ({ values: () => chain(rows) })),
        select: jest.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })),
        delete: jest.fn(() => ({ where: () => Promise.resolve() })),
      };
      (mockDb.transaction as jest.Mock).mockImplementation(async (run: (t: typeof tx) => unknown) => run(tx));

      const result = await createRequirement({ title: "Tagged", id: clientId, tags: "ai, Auth, ai" });

      expect(result).toEqual({ id: clientId, success: true });
      expect(tx.select).toHaveBeenCalled(); // existing-tag lookup
      expect(tx.delete).toHaveBeenCalled(); // tag association replace
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
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
