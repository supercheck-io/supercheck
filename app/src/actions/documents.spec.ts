/**
 * Documents Server Actions Tests
 *
 * Test coverage for document management operations
 *
 * Test Categories:
 * - RBAC (permission checks)
 * - S3 Operations (upload, download, delete)
 * - Tenant Isolation (organization/project scoping)
 * - Audit Logging
 */

// Mock AWS SDK
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
}));

jest.mock("@/lib/s3-proxy", () => ({
  getS3Client: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({}),
  }),
}));

// Mock dependencies
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
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

// Import after mocks
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { getS3Client } from "@/lib/s3-proxy";

import {
  getDocuments,
  getDocument,
  getDocumentRequirements,
  getDocumentDownloadUrl,
  deleteDocument,
} from "./documents";

// Cast mocks
const mockDb = db as jest.Mocked<typeof db>;
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockHasPermission = hasPermission as jest.Mock;
const mockLogAuditEvent = logAuditEvent as jest.Mock;
const mockGetS3Client = getS3Client as jest.Mock;

describe("Documents Server Actions", () => {
  const testUserId = "user-test-123";
  const testOrgId = "org-test-456";
  const testProjectId = "project-test-789";
  const testDocumentId = "doc-test-111";

  const mockProjectContext = {
    userId: testUserId,
    organizationId: testOrgId,
    project: {
      id: testProjectId,
      name: "Test Project",
    },
  };

  const mockDocument = {
    id: testDocumentId,
    name: "test-doc.pdf",
    type: "pdf",
    storagePath: "projects/test/documents/test-doc.pdf",
    fileSize: 1024,
    projectId: testProjectId,
    organizationId: testOrgId,
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
    describe("getDocuments", () => {
      it("should require view permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await getDocuments();

        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient permissions");
        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "view", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });

      it("should return documents when authorized", async () => {
        const mockSelectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockResolvedValue([mockDocument]),
        };
        (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

        const result = await getDocuments();

        expect(result.success).toBe(true);
        expect(result.documents).toBeDefined();
      });
    });

    describe("getDocument", () => {
      it("should require view permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await getDocument(testDocumentId);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient permissions");
      });
    });

    describe("getDocumentRequirements", () => {
      it("should require view permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await getDocumentRequirements(testDocumentId);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient permissions");
      });
    });

    describe("getDocumentDownloadUrl", () => {
      it("should require view permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await getDocumentDownloadUrl(testDocumentId);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient permissions");
      });
    });

    describe("deleteDocument", () => {
      it("should require delete permission", async () => {
        mockHasPermission.mockResolvedValue(false);

        const result = await deleteDocument(testDocumentId);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Insufficient permissions");
        expect(mockHasPermission).toHaveBeenCalledWith("requirement", "delete", {
          organizationId: testOrgId,
          projectId: testProjectId,
        });
      });
    });
  });

  // ==========================================================================
  // TENANT ISOLATION TESTS
  // ==========================================================================

  describe("Tenant Isolation", () => {
    it("should scope document queries by projectId", async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      await getDocuments();

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockSelectChain.where).toHaveBeenCalled();
    });

    it("should verify document belongs to project before delete", async () => {
      // Mock document not found in current project
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      const result = await deleteDocument(testDocumentId);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Document not found");
    });
  });

  // ==========================================================================
  // AUDIT LOGGING TESTS
  // ==========================================================================

  describe("Audit Logging", () => {
    it("should log audit event on delete", async () => {
      // Mock document exists
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockDocument]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      // Mock delete
      const mockDeleteChain = {
        where: jest.fn().mockResolvedValue(undefined),
      };
      (mockDb.delete as jest.Mock).mockReturnValue(mockDeleteChain);

      await deleteDocument(testDocumentId);

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "document_deleted",
          resource: "requirement_document",
          resourceId: testDocumentId,
          success: true,
        })
      );
    });
  });

  // ==========================================================================
  // S3 OPERATIONS TESTS
  // ==========================================================================

  describe("S3 Operations", () => {
    it("should generate presigned download URL", async () => {
      // Mock document exists
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockDocument]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      const result = await getDocumentDownloadUrl(testDocumentId);

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://s3.example.com/presigned-url");
      expect(result.filename).toBe(mockDocument.name);
    });

    it("should continue delete even if S3 delete fails", async () => {
      // Mock document exists
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockDocument]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      // Mock S3 delete failure
      mockGetS3Client.mockReturnValue({
        send: jest.fn().mockRejectedValue(new Error("S3 error")),
      });

      // Mock DB delete success
      const mockDeleteChain = {
        where: jest.fn().mockResolvedValue(undefined),
      };
      (mockDb.delete as jest.Mock).mockReturnValue(mockDeleteChain);

      const result = await deleteDocument(testDocumentId);

      // Should still succeed because DB delete worked
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle document not found for download", async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      (mockDb.select as jest.Mock).mockReturnValue(mockSelectChain);

      const result = await getDocumentDownloadUrl("non-existent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Document not found");
    });

    it("should handle database errors gracefully", async () => {
      (mockDb.select as jest.Mock).mockImplementation(() => {
        throw new Error("Database error");
      });

      const result = await getDocuments();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to fetch documents");
    });
  });
});
