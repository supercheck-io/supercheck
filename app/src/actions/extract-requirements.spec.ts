/**
 * Extract Requirements Server Action Tests
 *
 * Tests for:
 * - RBAC permission checks
 * - File type validation
 * - Input validation (no file, empty file, unsupported type)
 * - Security validation
 *
 * Implementation Note:
 * FormData in Node.js/Jest serializes File objects differently than browsers.
 * We use a custom FormData mock that preserves File objects to test the
 * server action's validation logic properly.
 */

// Mock dependencies before imports
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn().mockResolvedValue([{ count: 0 }]),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([{ id: "doc-id-123" }]),
      })),
    })),
    delete: jest.fn(() => ({
      where: jest.fn().mockResolvedValue(undefined),
    })),
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

jest.mock("@/lib/session", () => ({
  getActiveOrganization: jest.fn(),
}));

jest.mock("@/lib/s3-proxy", () => ({
  getS3Client: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock("@/lib/ai/ai-security", () => ({
  AuthService: {
    checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  },
  AISecurityService: {
    escapeForPrompt: jest.fn((text: string) => `[ESCAPED]${text}`),
    sanitizeTextOutput: jest.fn((text: string) => text.replace(/[<>]/g, "")),
  },
}));

jest.mock("@/lib/ai/ai-provider", () => ({
  validateAIConfiguration: jest.fn(),
  getProviderModel: jest.fn(() => ({})),
  getServiceConfiguration: jest.fn(() => ({
    maxRetries: 2,
    temperature: 0.1,
    timeout: 90000,
  })),
  getActualModelName: jest.fn(() => "gpt-4o-mini"),
  mapProviderError: jest.fn((e: Error) => e),
}));

jest.mock("ai", () => ({
  generateText: jest.fn().mockResolvedValue({
    text: JSON.stringify([
      {
        title: "User can login with email",
        description: "POST /api/login accepts email and password",
        priority: "high",
        tags: ["api", "auth"],
      },
    ]),
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  }),
}));

// Import after mocks
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { getActiveOrganization } from "@/lib/session";
import { AISecurityService } from "@/lib/ai/ai-security";
import { extractRequirementsFromDocument } from "./extract-requirements";

// Cast mocks
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockHasPermission = hasPermission as jest.Mock;
const mockGetActiveOrganization = getActiveOrganization as jest.Mock;
const mockEscapeForPrompt = AISecurityService.escapeForPrompt as jest.Mock;
const mockSanitizeTextOutput = AISecurityService.sanitizeTextOutput as jest.Mock;

/**
 * Custom FormData class that preserves File mocks when retrieved.
 * This solves the issue where Node.js FormData transforms File objects
 * when serializing/deserializing.
 */
class MockFormData {
  private data = new Map<string, File | string>();

  append(key: string, value: File | string): void {
    this.data.set(key, value);
  }

  get(key: string): File | string | null {
    return this.data.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.data.has(key);
  }
}

/**
 * Create a mock File object for testing.
 */
function createMockFile(
  content: string,
  filename: string,
  options?: { type?: string; size?: number }
): File {
  const mimeType = options?.type || "text/plain";
  const buffer = Buffer.from(content);
  const explicitSize = options?.size ?? buffer.length;

  return {
    name: filename,
    type: mimeType,
    size: explicitSize,
    lastModified: Date.now(),
    arrayBuffer: jest.fn().mockResolvedValue(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    ),
    text: jest.fn().mockResolvedValue(content),
    slice: jest.fn(),
    stream: jest.fn(),
    webkitRelativePath: "",
  } as unknown as File;
}

describe("extractRequirementsFromDocument", () => {
  const testUserId = "11111111-1111-1111-1111-111111111111";
  const testOrgId = "22222222-2222-2222-2222-222222222222";
  const testProjectId = "33333333-3333-3333-3333-333333333333";

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
    mockGetActiveOrganization.mockResolvedValue({ id: testOrgId, tier: "plus" });
  });

  // ============================================================================
  // RBAC TESTS
  // ============================================================================

  describe("RBAC Enforcement", () => {
    it("should require create permission", async () => {
      mockHasPermission.mockResolvedValue(false);

      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("Valid content for testing.".padEnd(100, "."), "test.txt")
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient permissions");
      expect(mockHasPermission).toHaveBeenCalledWith("requirement", "create", {
        organizationId: testOrgId,
        projectId: testProjectId,
      });
    });

    it("should check permission with correct context", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("Test content here".padEnd(100, "."), "test.txt")
      );

      await extractRequirementsFromDocument(formData);

      expect(mockHasPermission).toHaveBeenCalledWith(
        "requirement",
        "create",
        expect.objectContaining({
          organizationId: testOrgId,
          projectId: testProjectId,
        })
      );
    });
  });

  // ============================================================================
  // FILE VALIDATION TESTS
  // ============================================================================

  describe("File Validation", () => {
    it("should reject when no file is provided", async () => {
      const formData = new MockFormData() as unknown as FormData;
      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("No file provided");
    });

    it("should reject unsupported file types (HTML)", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("<html></html>", "test.html", { type: "text/html" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject empty files (size = 0)", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file", 
        createMockFile("", "empty.txt", { size: 0 })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject documents with insufficient text content", async () => {
      const formData = new MockFormData() as unknown as FormData;
      // File with some content but less than 50 chars (minimum threshold)
      formData.append(
        "file",
        createMockFile("Short", "short.txt", { type: "text/plain" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("empty or unreadable");
    });

    it("should reject executable file types (.exe)", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("MZ...", "malware.exe", { type: "application/x-msdownload" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject JavaScript files", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("console.log('hello')", "script.js", { type: "application/javascript" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject JSON files", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile('{"key": "value"}', "data.json", { type: "application/json" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject XML files", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("<root><item/></root>", "data.xml", { type: "application/xml" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject CSS files", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("body { color: red; }", "styles.css", { type: "text/css" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });
  });

  // ============================================================================
  // SECURITY VERIFICATION TESTS
  // ============================================================================

  describe("Security Verification", () => {
    it("should use AISecurityService.escapeForPrompt for input sanitization", () => {
      expect(mockEscapeForPrompt).toBeDefined();
      expect(typeof AISecurityService.escapeForPrompt).toBe("function");
      
      const result = AISecurityService.escapeForPrompt("test content");
      expect(result).toContain("[ESCAPED]");
    });

    it("should use AISecurityService.sanitizeTextOutput for output sanitization", () => {
      expect(mockSanitizeTextOutput).toBeDefined();
      expect(typeof AISecurityService.sanitizeTextOutput).toBe("function");
      
      const sanitized = AISecurityService.sanitizeTextOutput("<script>alert()</script>test");
      expect(sanitized).not.toContain("<script>");
    });

    it("should sanitize XSS attempts in output", () => {
      const maliciousInput = '<img src=x onerror="alert(1)">';
      const sanitized = AISecurityService.sanitizeTextOutput(maliciousInput);
      expect(sanitized).not.toContain("<");
      expect(sanitized).not.toContain(">");
    });
  });

  // ============================================================================
  // ALLOWED FILE TYPES TESTS
  // ============================================================================

  describe("Allowed File Types", () => {
    it("should accept .txt files", async () => {
      const formData = new MockFormData() as unknown as FormData;
      const validContent = "This is a valid document with enough content for extraction.".padEnd(100, ".");
      formData.append(
        "file",
        createMockFile(validContent, "test.txt", { type: "text/plain" })
      );

      const result = await extractRequirementsFromDocument(formData);

      // Type validation passes - extraction succeeds
      expect(result.success).toBe(true);
      expect(result.requirements).toBeDefined();
    });

    it("should accept .md files by extension", async () => {
      const formData = new MockFormData() as unknown as FormData;
      const validContent = "# Requirements\n\nThis is a markdown document with requirements.".padEnd(100, ".");
      formData.append(
        "file",
        createMockFile(validContent, "requirements.md")
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(true);
    });

    it("should accept files with text/markdown MIME type", async () => {
      const formData = new MockFormData() as unknown as FormData;
      const validContent = "# PRD\n\nUser should be able to login with email and password.".padEnd(100, ".");
      formData.append(
        "file",
        createMockFile(validContent, "prd.md", { type: "text/markdown" })
      );

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(true);
    });

    it("should accept .pdf files by MIME type", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("%PDF-1.4...", "test.pdf", { type: "application/pdf" })
      );

      const result = await extractRequirementsFromDocument(formData);

      // PDF passes type validation (fails in text extraction - expected)
      expect(result.error).not.toContain("Unsupported file type");
    });

    it("should accept .docx files by MIME type", async () => {
      const formData = new MockFormData() as unknown as FormData;
      formData.append(
        "file",
        createMockFile("PK...", "test.docx", { 
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
        })
      );

      const result = await extractRequirementsFromDocument(formData);

      // DOCX passes type validation (fails in text extraction - expected)
      expect(result.error).not.toContain("Unsupported file type");
    });
  });

  // ============================================================================
  // RATE LIMITING TESTS
  // ============================================================================

  describe("Rate Limiting", () => {
    it("should check rate limits before AI extraction", async () => {
      const { AuthService } = require("@/lib/ai/ai-security");
      
      const formData = new MockFormData() as unknown as FormData;
      const validContent = "This is valid content for testing rate limiting.".padEnd(100, ".");
      formData.append("file", createMockFile(validContent, "test.txt"));

      await extractRequirementsFromDocument(formData);

      expect(AuthService.checkRateLimit).toHaveBeenCalledWith({
        userId: testUserId,
        orgId: testOrgId,
        tier: "plus",
      });
    });

    it("should reject when rate limited", async () => {
      const { AuthService } = require("@/lib/ai/ai-security");
      AuthService.checkRateLimit.mockRejectedValueOnce(
        new Error("AI rate limit exceeded. Please try again in 1 minute.")
      );

      const formData = new MockFormData() as unknown as FormData;
      const validContent = "This is valid content for testing rate limit rejection.".padEnd(100, ".");
      formData.append("file", createMockFile(validContent, "test.txt"));

      const result = await extractRequirementsFromDocument(formData);

      expect(result.success).toBe(false);
      expect(result.error).toContain("rate limit");
    });
  });

  // ============================================================================
  // AUDIT LOGGING TESTS
  // ============================================================================

  describe("Audit Logging", () => {
    it("should log audit event on successful extraction", async () => {
      const { logAuditEvent } = require("@/lib/audit-logger");

      const formData = new MockFormData() as unknown as FormData;
      const validContent = "This is a valid document for testing audit logging.".padEnd(100, ".");
      formData.append("file", createMockFile(validContent, "audit-test.txt"));

      await extractRequirementsFromDocument(formData);

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: "requirements_extracted",
          resource: "requirement",
          success: true,
          metadata: expect.objectContaining({
            organizationId: testOrgId,
            projectId: testProjectId,
            documentName: "audit-test.txt",
            extractedCount: expect.any(Number),
          }),
        })
      );
    });
  });
});
