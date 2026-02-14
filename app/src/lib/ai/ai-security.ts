/**
 * Security utilities for AI Fix feature
 *
 * This module provides comprehensive security measures for AI-powered features:
 * - Multi-layer input sanitization with obfuscation detection
 * - Prompt injection protection with instruction marker removal
 * - AST-based output validation
 * - URL validation with strict hostname matching
 * - Rate limiting integration
 */

import { aiCodeValidator, validateAICode } from "./ai-code-validator";
import { aiRateLimiter, RateLimitResult } from "./ai-rate-limiter";
import { isSelfHosted } from "@/lib/feature-flags";

// Prompt injection patterns to detect and remove
// These patterns are carefully tuned to catch malicious injection attempts
// while avoiding false positives on legitimate code and comments
const PROMPT_INJECTION_PATTERNS = [
  // Direct instruction override attempts (require explicit manipulation language)
  /\b(please\s+)?ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
  /\b(please\s+)?disregard\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
  /\b(please\s+)?forget\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
  /\boverride\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,

  // Instruction injection markers (specific syntax patterns)
  /\[SYSTEM\]/g, // Case-sensitive for exact match
  /\[INST\]/g,
  /\[\/INST\]/g,
  /<\|system\|>/g,
  /<\|user\|>/g,
  /<\|assistant\|>/g,
  /<<SYS>>/g,
  /<\/SYS>/g,
  /^###\s*(System|Human|AI):/gim, // Only at line start
  /^##\s*(System|Human|AI):/gim,

  // Developer/jailbreak mode (specific phrases)
  /\bjailbreak\s+(mode|enabled|activated)/gi,
  /\bDAN\s+mode\b/gi,

  // Delimiter breaking attempts
  /```\s*system\b/gi,
  /```\s*instruction\b/gi,
];

// Dangerous code patterns with improved detection (handles obfuscation)
const DANGEROUS_CODE_PATTERNS = [
  // eval and Function constructor (with whitespace variations)
  /\beval\s*\(/gi,
  /\bevaluation\s*\(/gi,
  /\bFunction\s*\(/gi,
  /\bnew\s+Function\s*\(/gi,

  // Dynamic execution methods
  /setTimeout\s*\(\s*['"`]/gi, // setTimeout with string argument
  /setInterval\s*\(\s*['"`]/gi, // setInterval with string argument

  // Script injection
  /document\.write/gi,
  /<script[\s>]/gi,
  /javascript\s*:/gi,
  /data\s*:/gi,
  /vbscript\s*:/gi,

  // Dynamic imports (suspicious usage)
  /import\s*\(\s*[^)]+\+/gi, // import() with concatenation
  /require\s*\(\s*[^)]+\+/gi, // require() with concatenation

  // Bracket notation access for obfuscation
  /\bwindow\s*\[\s*['"`]\s*e\s*['"`]\s*\+/gi, // window['e' + ...
  /\bglobal\s*\[\s*['"`]\s*e\s*['"`]\s*\+/gi, // global['e' + ...
  /\bthis\s*\[\s*['"`]\s*e\s*['"`]\s*\+/gi, // this['e' + ...

  // Hex/unicode escape patterns (potential obfuscation)
  /\\x65\\x76\\x61\\x6c/gi, // \x65\x76\x61\x6c = 'eval'
  /\\u0065\\u0076\\u0061\\u006c/gi, // unicode for 'eval'
];

// Obfuscation detection patterns
const OBFUSCATION_PATTERNS = [
  // String.fromCharCode with multiple arguments (obfuscated strings)
  /String\.fromCharCode\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+/gi,

  // atob with long encoded strings
  /\batob\s*\(\s*['"`][A-Za-z0-9+/=]{30,}['"`]\s*\)/gi,

  // Extensive hex escapes
  /(\\x[0-9a-f]{2}){5,}/gi,

  // Multiple bracket notation in sequence
  /\]\s*\[\s*['"`]/g,
];

export class AISecurityService {
  /**
   * Sanitize code input with multi-layer protection
   * Handles obfuscation attempts and normalizes encoding
   */
  static sanitizeCodeInput(code: string): string {
    if (typeof code !== "string") {
      throw new Error("Code input must be a string");
    }

    // Layer 1: Normalize encoding (NFKC) to prevent unicode evasion
    let sanitized = code.normalize("NFKC");

    // Layer 1.5: Remove zero-width and invisible Unicode characters
    // These can be used to bypass text pattern detection (e.g., "ig​nore" with zero-width space)
    // Includes: Zero-width space, joiner, non-joiner, BOM, directional marks, invisible separators
    sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u2060-\u2064\u2066-\u206F]/g, "");

    // Layer 2: Remove control characters (except newlines, tabs, spaces)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // Layer 3: Remove prompt injection patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "/* INJECTION_REMOVED */");
    }

    // Layer 4: Remove dangerous code patterns
    for (const pattern of DANGEROUS_CODE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "/* SECURITY_REMOVED */");
    }

    // Layer 5: Check for obfuscation and warn/sanitize
    let obfuscationCount = 0;
    for (const pattern of OBFUSCATION_PATTERNS) {
      const matches = sanitized.match(pattern);
      if (matches) {
        obfuscationCount += matches.length;
      }
    }

    if (obfuscationCount > 5) {
      // Heavy obfuscation detected - more aggressive sanitization
      sanitized = sanitized
        .replace(/(\\x[0-9a-f]{2})+/gi, "/* ENCODED_REMOVED */")
        .replace(/String\.fromCharCode\s*\([^)]+\)/gi, "/* CHARCODE_REMOVED */")
        .replace(/\batob\s*\([^)]+\)/gi, "/* ATOB_REMOVED */");
    }

    return sanitized.trim();
  }

  /**
   * Validate and sanitize AI output code
   * Uses AST-based validation for accurate detection
   */
  static sanitizeCodeOutput(
    code: string,
    options: {
      testType?: "browser" | "api" | "custom" | "database" | "performance";
      strict?: boolean;
    } = {}
  ): string {
    if (typeof code !== "string") {
      throw new Error("Code output must be a string");
    }

    const { testType = "browser", strict = false } = options;

    // Use the AST-based code validator
    const validationResult = validateAICode(code, { testType, strict });

    if (!validationResult.isValid) {
      // Log violations for monitoring
      const criticalViolations = validationResult.violations.filter(
        (v) => v.severity === "critical"
      );

      if (criticalViolations.length > 0) {
        console.error(
          "[AI Security] Critical violations detected in AI output:",
          criticalViolations.map((v) => v.message)
        );
        throw new Error(
          `AI-generated code contains security violations: ${criticalViolations[0].message}`
        );
      }

      // For non-critical violations, log warning and return sanitized
      console.warn(
        "[AI Security] Non-critical violations in AI output:",
        validationResult.violations.map((v) => v.message)
      );
    }

    return validationResult.sanitizedCode || code.trim();
  }

  /**
   * Sanitize text output (explanations, etc.)
   * Removes HTML/script tags and prompt injection attempts
   */
  static sanitizeTextOutput(text: string): string {
    if (typeof text !== "string") {
      return "";
    }

    // Remove any HTML/script tags from explanations iteratively to handle nested patterns
    // e.g., "<<script>script>" becomes "<script>" after first pass, then "" after second
    let sanitized = text;
    let prev = '';
    let iterations = 0;
    const maxIterations = 100; // Safety limit
    while (prev !== sanitized && iterations < maxIterations) {
      prev = sanitized;
      sanitized = sanitized.replace(/<[^>]*>/g, "");
      iterations++;
    }

    // Remove prompt injection patterns from explanations too
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REMOVED]");
    }

    return sanitized.trim();
  }

  /**
   * Escape user content for safe inclusion in prompts
   * Prevents prompt injection by escaping instruction markers
   */
  static escapeForPrompt(content: string): string {
    if (typeof content !== "string") {
      return "";
    }

    // Normalize first
    let escaped = content.normalize("NFKC");

    // Remove control characters
    escaped = escaped.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // Escape HTML entities to prevent breaking XML-style delimiters
    escaped = escaped
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Remove instruction markers that could break prompt structure
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      escaped = escaped.replace(pattern, "[USER_TEXT]");
    }

    // Escape triple backticks to prevent breaking code blocks
    escaped = escaped.replace(/```/g, "` ` `");

    return escaped;
  }

  /**
   * Get AI code validator instance for direct use
   */
  static getCodeValidator() {
    return aiCodeValidator;
  }

  /**
   * Get AI rate limiter instance for direct use
   */
  static getRateLimiter() {
    return aiRateLimiter;
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
    const validTestTypes = [
      "browser",
      "api",
      "custom",
      "database",
      "performance",
    ];
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

  // Validate report URL is from trusted source using strict hostname matching
  static validateReportUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);

      // Only allow HTTP(S) in production, also allow http for development
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction && parsedUrl.protocol !== "https:") {
        // Allow http only for localhost in production (for internal services)
        if (
          parsedUrl.protocol === "http:" &&
          (parsedUrl.hostname === "localhost" ||
            parsedUrl.hostname === "127.0.0.1")
        ) {
          // Allow localhost HTTP in production for internal services
        } else {
          return false;
        }
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return false;
      }

      // Build set of trusted hostnames for exact matching
      const trustedHosts = new Set<string>(["localhost", "127.0.0.1"]);

      // Add the configured S3 endpoint host
      const s3Endpoint = process.env.S3_ENDPOINT;
      if (s3Endpoint) {
        try {
          const s3Host = new URL(s3Endpoint).hostname;
          trustedHosts.add(s3Host);
        } catch {
          // Ignore invalid S3_ENDPOINT URLs
        }
      }

      // Check for exact hostname match first
      if (trustedHosts.has(parsedUrl.hostname)) {
        return true;
      }

      // Check for valid S3 subdomain patterns using strict regex
      // Valid patterns:
      // - bucket.s3.region.amazonaws.com
      // - bucket.s3.amazonaws.com
      // - s3.region.amazonaws.com/bucket
      const s3SubdomainPattern =
        /^[a-z0-9][a-z0-9.-]*\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/i;

      if (s3SubdomainPattern.test(parsedUrl.hostname)) {
        return true;
      }

      // Check for exact match with common S3 regional endpoints
      const s3RegionalEndpoints = [
        "s3.amazonaws.com",
        "s3.us-east-1.amazonaws.com",
        "s3.us-east-2.amazonaws.com",
        "s3.us-west-1.amazonaws.com",
        "s3.us-west-2.amazonaws.com",
        "s3.eu-west-1.amazonaws.com",
        "s3.eu-west-2.amazonaws.com",
        "s3.eu-central-1.amazonaws.com",
        "s3.ap-southeast-1.amazonaws.com",
        "s3.ap-southeast-2.amazonaws.com",
        "s3.ap-northeast-1.amazonaws.com",
      ];

      if (s3RegionalEndpoints.includes(parsedUrl.hostname)) {
        return true;
      }

      // No match found - reject
      console.warn(
        `[AI Security] Rejected URL with untrusted hostname: ${parsedUrl.hostname}`
      );
      return false;
    } catch (error) {
      console.error("[AI Security] URL validation error:", error);
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
  tier?: string;
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
        tier: (activeOrg as unknown as Record<string, unknown> | undefined)
          ?.tier as string | undefined,
      };
    } catch {
      throw new Error("Authentication required");
    }
  }

  /**
   * Check rate limit for AI requests
   * Uses Redis-based multi-tier rate limiting
   */
  static async checkRateLimit(options: {
    userId?: string;
    orgId?: string;
    ip?: string;
    tier?: string;
  }): Promise<RateLimitResult> {
    // Self-hosted mode skips rate limiting
    if (isSelfHosted()) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        limit: Number.MAX_SAFE_INTEGER,
        resetAt: new Date(),
      };
    }

    const result = await aiRateLimiter.checkRateLimit(options);

    if (!result.allowed) {
      const retryAfterSeconds = result.retryAfter || 60;
      throw new Error(
        `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds. ` +
          `Limit type: ${result.limitType || "unknown"}`
      );
    }

    return result;
  }

  /**
   * Track token usage after successful AI request
   */
  static async trackTokenUsage(
    orgId: string,
    tokensUsed: number,
    tier?: string
  ): Promise<RateLimitResult> {
    return aiRateLimiter.checkAndTrackTokens(orgId, tokensUsed, tier);
  }
}
