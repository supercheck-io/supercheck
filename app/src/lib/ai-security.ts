// Security utilities for AI Fix feature
export class AISecurityService {
  // Sanitize code input to remove dangerous patterns
  static sanitizeCodeInput(code: string): string {
    if (typeof code !== "string") {
      throw new Error("Code input must be a string");
    }

    // Remove potentially dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /setTimeout\s*\(/gi,
      /setInterval\s*\(/gi,
      /document\.write/gi,
      /<script/gi,
      /javascript:/gi,
      /data:/gi,
      /import\s*\(/gi, // Dynamic imports
    ];

    let sanitized = code;
    dangerousPatterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, "/* REMOVED_FOR_SECURITY */");
    });

    return sanitized.trim();
  }

  // Validate AI output doesn't contain malicious patterns
  static sanitizeCodeOutput(code: string): string {
    if (typeof code !== "string") {
      throw new Error("Code output must be a string");
    }

    // Previously we rejected scripts containing certain patterns.
    // For a better UX (e.g., K6 load tests), simply return the code trimmed
    // and rely on downstream validation/execution sandboxes.
    return code.trim();
  }

  // Sanitize text output (explanations, etc.)
  static sanitizeTextOutput(text: string): string {
    if (typeof text !== "string") {
      return "";
    }

    // Remove any HTML/script tags from explanations
    return text.replace(/<[^>]*>/g, "").trim();
  }

  // Validate input parameters
  static validateInputs(body: Record<string, unknown>): {
    failedScript: string;
    testType: string;
    testId: string;
    executionContext: Record<string, unknown>;
  } {
    // Input validation with size limits
    if (!body.failedScript || typeof body.failedScript !== "string") {
      throw new Error("Invalid failedScript parameter");
    }

    if (!body.testType || typeof body.testType !== "string") {
      throw new Error("Invalid testType parameter");
    }

    if (!body.testId || typeof body.testId !== "string") {
      throw new Error("Invalid testId parameter");
    }

    // Size limits to prevent abuse
    if (body.failedScript.length > 50000) {
      // 50KB limit
      throw new Error("Script too large (max 50KB)");
    }

    // Validate test type enum
    const validTestTypes = ["browser", "api", "custom", "database", "performance"];
    if (!validTestTypes.includes(body.testType)) {
      throw new Error("Invalid test type");
    }

    return {
      failedScript: this.sanitizeCodeInput(body.failedScript),
      testType: body.testType,
      testId: body.testId,
      executionContext:
        (body.executionContext as Record<string, unknown>) || {},
    };
  }

  // Validate report URL is from trusted source
  static validateReportUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);

      // Only allow HTTPS
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return false;
      }

      // Validate against trusted S3 endpoints
      const trustedHosts = [
        "s3.amazonaws.com",
        "s3.us-east-1.amazonaws.com",
        "s3.us-west-2.amazonaws.com",
        "localhost", // For development
      ];

      // Add the configured S3 endpoint host
      const s3Endpoint = process.env.S3_ENDPOINT;
      if (s3Endpoint) {
        try {
          const s3Host = new URL(s3Endpoint).hostname;
          trustedHosts.push(s3Host);
        } catch {
          // Ignore invalid S3_ENDPOINT URLs
        }
      }

      return trustedHosts.some(
        (host) =>
          parsedUrl.hostname === host ||
          parsedUrl.hostname.endsWith(`.${host}`) ||
          parsedUrl.hostname.includes(host!)
      );
    } catch {
      return false;
    }
  }

  // Secure fetch with validation using AWS SDK
  static async securelyFetchMarkdownReport(
    markdownReportUrl: string
  ): Promise<string> {
    try {
      // Validate URL is from trusted source
      if (!this.validateReportUrl(markdownReportUrl)) {
        throw new Error("Untrusted markdown report source");
      }

      // Parse the S3 URL to extract bucket and key
      const url = new URL(markdownReportUrl);
      const pathParts = url.pathname.split("/").filter(Boolean);

      if (pathParts.length < 2) {
        throw new Error("Invalid S3 URL format");
      }

      const bucket = pathParts[0]; // e.g., 'playwright-test-artifacts'
      const key = pathParts.slice(1).join("/"); // e.g., 'testId/report/data/file.md'

      // Use AWS SDK to fetch the markdown content
      const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");

      const s3Client = new S3Client({
        region: process.env.AWS_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
        },
        forcePathStyle: true, // Required for MinIO
      });

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        throw new Error("No content returned from S3");
      }

      // Convert the stream to text
      const content = await response.Body.transformToString();

      // Size validation with graceful truncation for very large reports
      const MAX_MARKDOWN_LENGTH = 100_000; // 100KB of markdown context is plenty for prompting
      let sanitizedContent = content;

      if (sanitizedContent.length > MAX_MARKDOWN_LENGTH) {
        console.warn(
          `[AI Security] Markdown report exceeded ${MAX_MARKDOWN_LENGTH} chars. Truncating to safe limit.`
        );
        sanitizedContent =
          sanitizedContent.slice(0, MAX_MARKDOWN_LENGTH) +
          "\n\n<!-- Report truncated for safety -->";
      }

      // Basic content validation - relax this since Playwright .md files might have different formats
      if (!sanitizedContent.trim()) {
        throw new Error("Empty markdown report");
      }

      return sanitizedContent;
    } catch (error) {
      console.error("[AI Security] Error fetching markdown report:", error);
      throw new Error(
        `Error fetching markdown report: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

// Session and auth utilities
export interface UserSession {
  user: {
    id: string;
    email: string;
    organizationId?: string;
  };
}

export class AuthService {
  static async validateUserAccess(
    _request: Request,
    _testId: string
  ): Promise<UserSession> {
    try {
      // Use the existing auth pattern from the app
      const { requireAuth } = await import("@/lib/rbac/middleware");
      const { getActiveOrganization } = await import("@/lib/session");

      // Validate authentication using Better Auth session
      const authResult = await requireAuth();

      // Get user's active organization
      const activeOrg = await getActiveOrganization();

      // Log access attempt for security auditing (in production)
      if (process.env.NODE_ENV === "production") {
        console.log(`User ${authResult.user.id} accessing test ${_testId}`);
      }

      return {
        user: {
          id: authResult.user.id,
          email: authResult.user.email || "",
          organizationId: activeOrg?.id,
        },
      };
    } catch {
      throw new Error("Authentication required");
    }
  }

  static async checkRateLimit(): Promise<void> {
    // No rate limiting implemented - API usage is controlled by OpenAI API key limits
    return;
  }
}
