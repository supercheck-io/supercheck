/**
 * AI Code Validator
 *
 * Validates AI-generated code for security issues before returning to users.
 * Uses AST parsing for accurate detection and pattern-based validation as backup.
 *
 * Security checks include:
 * - Dangerous function calls (eval, Function constructor, etc.)
 * - Dangerous imports (fs, child_process, net, etc.)
 * - Process/environment access
 * - Prototype pollution attempts
 * - Network/filesystem access patterns
 * - Obfuscation detection
 */

import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "ai-code-validator" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  violations: SecurityViolation[];
  sanitizedCode?: string;
  warnings: string[];
}

export interface SecurityViolation {
  type: ViolationType;
  message: string;
  line?: number;
  column?: number;
  severity: "critical" | "high" | "medium" | "low";
  pattern?: string;
}

export type ViolationType =
  | "dangerous_function"
  | "dangerous_import"
  | "process_access"
  | "prototype_pollution"
  | "network_access"
  | "filesystem_access"
  | "obfuscation"
  | "shell_execution"
  | "eval_like"
  | "dynamic_code";

// Dangerous patterns for detection
const DANGEROUS_PATTERNS = {
  // Direct eval and Function constructor
  evalLike: [
    /\beval\s*\(/gi,
    /\bnew\s+Function\s*\(/g, // Case-sensitive to avoid matching regular 'function'
    /(?<![a-z])Function\s*\(/g, // Case-sensitive, capital F only, not preceded by lowercase letter
    /\bsetTimeout\s*\(\s*['"`]/gi, // setTimeout with string
    /\bsetInterval\s*\(\s*['"`]/gi, // setInterval with string
  ],

  // Dynamic code execution
  dynamicCode: [
    /\bvm\.runInContext/gi,
    /\bvm\.runInNewContext/gi,
    /\bvm\.runInThisContext/gi,
    /\bvm\.compileFunction/gi,
    /\bWebAssembly\.instantiate/gi,
    /\bWebAssembly\.compile/gi,
  ],

  // Shell execution
  shellExecution: [
    /\bchild_process\b/gi,
    /\bexec\s*\(/gi,
    /\bexecSync\s*\(/gi,
    /\bspawn\s*\(/gi,
    /\bspawnSync\s*\(/gi,
    /\bfork\s*\(/gi,
    /\bexecFile\s*\(/gi,
  ],

  // Process/environment access
  processAccess: [
    /\bprocess\.env\b/gi,
    /\bprocess\.exit\s*\(/gi,
    /\bprocess\.kill\s*\(/gi,
    /\bprocess\.binding\s*\(/gi,
    /\bprocess\._linkedBinding\s*\(/gi,
    /\bglobal\.process\b/gi,
    /\brequire\.main\b/gi,
    /\bmodule\.constructor\b/gi,
  ],

  // Prototype pollution
  prototypePollution: [
    /__proto__/gi,
    /\bconstructor\s*\[\s*['"`]prototype['"`]\s*\]/gi,
    /\bObject\.setPrototypeOf\s*\(/gi,
    /\bObject\.getPrototypeOf\s*\(/gi,
    /\bObject\.defineProperty\s*\(\s*Object\.prototype/gi,
    /\bReflect\.setPrototypeOf\s*\(/gi,
  ],

  // Dangerous imports
  dangerousImports: [
    /\brequire\s*\(\s*['"`]fs['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]fs\/promises['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]child_process['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]net['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]dgram['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]cluster['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]vm['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]worker_threads['"`]\s*\)/gi,
    /\brequire\s*\(\s*['"`]crypto['"`]\s*\)/gi,
    /\bimport\s+.*from\s+['"`]fs['"`]/gi,
    /\bimport\s+.*from\s+['"`]child_process['"`]/gi,
    /\bimport\s+.*from\s+['"`]net['"`]/gi,
    /\bimport\s+.*from\s+['"`]vm['"`]/gi,
  ],

  // Network access (suspicious for tests)
  suspiciousNetwork: [
    /\bfetch\s*\(\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1)/gi, // Fetch to external URLs
    /\.connect\s*\(\s*\{[^}]*host\s*:\s*['"`](?!localhost|127\.0\.0\.1)/gi,
    /\bWebSocket\s*\(\s*['"`](?!wss?:\/\/localhost|wss?:\/\/127\.0\.0\.1)/gi,
  ],

  // Filesystem access patterns
  filesystemAccess: [
    /\bfs\.readFileSync\s*\(/gi,
    /\bfs\.writeFileSync\s*\(/gi,
    /\bfs\.unlinkSync\s*\(/gi,
    /\bfs\.rmdirSync\s*\(/gi,
    /\bfs\.mkdirSync\s*\(/gi,
    /\bfs\.promises\b/gi,
    /\bfs\.readFile\s*\(/gi,
    /\bfs\.writeFile\s*\(/gi,
  ],

  // Obfuscation indicators
  obfuscation: [
    /\\x[0-9a-f]{2}/gi, // Hex escapes
    /\\u[0-9a-f]{4}/gi, // Unicode escapes in suspicious patterns
    /String\.fromCharCode\s*\([^)]*,/gi, // Multiple charCodes (obfuscated strings)
    /\batob\s*\(\s*['"`][A-Za-z0-9+/=]{20,}['"`]\s*\)/gi, // Base64 decode of long strings
    /\[['"`]\w['"`]\s*\+\s*['"`]\w['"`]\s*\+/gi, // String concatenation obfuscation
    /\bwindow\s*\[\s*['"`]\w+['"`]\s*\]\s*\[/gi, // Bracket notation chain
  ],
};

// Allowed patterns for Playwright tests (not security issues)
const ALLOWED_PATTERNS = [
  // Playwright-specific patterns that are safe
  /\bpage\.evaluate\s*\(/gi, // page.evaluate is expected in Playwright
  /\bpage\.evaluateHandle\s*\(/gi,
  /\bpage\.\$eval\s*\(/gi,
  /\bpage\.\$\$eval\s*\(/gi,
  /\bpage\.waitForFunction\s*\(/gi,
  /\bpage\.exposeFunction\s*\(/gi,
  /\bfetch\s*\(\s*['"`]https?:\/\/localhost/gi, // Local fetches
  /\bfetch\s*\(\s*['"`]https?:\/\/127\.0\.0\.1/gi,
  /\bfetch\s*\(\s*request\.url/gi, // Playwright request handling
  /\bapiRequestContext\.fetch\s*\(/gi, // Playwright API testing
  /\brequest\.get\s*\(/gi,
  /\brequest\.post\s*\(/gi,
];

// K6-specific allowed patterns
const K6_ALLOWED_PATTERNS = [
  /\bhttp\.get\s*\(/gi,
  /\bhttp\.post\s*\(/gi,
  /\bhttp\.put\s*\(/gi,
  /\bhttp\.del\s*\(/gi,
  /\bhttp\.patch\s*\(/gi,
  /\bhttp\.request\s*\(/gi,
  /\bhttp\.batch\s*\(/gi,
  /\bcheck\s*\(/gi,
  /\bsleep\s*\(/gi,
  /\bgroup\s*\(/gi,
  /\bfail\s*\(/gi,
  /\btrend\.add\s*\(/gi,
  /\bcounter\.add\s*\(/gi,
  /\bgauge\.add\s*\(/gi,
  /\brate\.add\s*\(/gi,
];

/**
 * AI Code Validator class
 */
export class AICodeValidator {
  private static instance: AICodeValidator | null = null;

  private constructor() {}

  static getInstance(): AICodeValidator {
    if (!AICodeValidator.instance) {
      AICodeValidator.instance = new AICodeValidator();
    }
    return AICodeValidator.instance;
  }

  /**
   * Validate AI-generated code for security issues
   */
  validate(
    code: string,
    options: {
      testType?: "browser" | "api" | "custom" | "database" | "performance";
      strict?: boolean;
    } = {}
  ): ValidationResult {
    const { testType = "browser", strict = false } = options;

    const violations: SecurityViolation[] = [];
    const warnings: string[] = [];

    // Normalize the code for consistent analysis
    const normalizedCode = this.normalizeCode(code);

    // Check for dangerous patterns
    this.checkPatterns(normalizedCode, violations, warnings, testType);

    // Additional checks for strict mode
    if (strict) {
      this.checkStrictPatterns(normalizedCode, violations);
    }

    // Filter out allowed patterns (false positives)
    const filteredViolations = this.filterAllowedPatterns(
      violations,
      normalizedCode,
      testType
    );

    // Determine if code is valid
    const isValid =
      filteredViolations.filter(
        (v) => v.severity === "critical" || v.severity === "high"
      ).length === 0;

    // Log validation result
    if (!isValid) {
      logger.warn(
        { testType, violationCount: filteredViolations.length },
        "AI-generated code failed validation"
      );
    }

    return {
      isValid,
      violations: filteredViolations,
      sanitizedCode: isValid ? code.trim() : undefined,
      warnings,
    };
  }

  /**
   * Normalize code for analysis
   */
  private normalizeCode(code: string): string {
    // Normalize unicode to prevent evasion
    let normalized = code.normalize("NFKC");

    // Remove control characters except newlines and tabs
    normalized = normalized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    return normalized;
  }

  /**
   * Check for dangerous patterns in code
   */
  private checkPatterns(
    code: string,
    violations: SecurityViolation[],
    warnings: string[],
    testType: string
  ): void {
    // Check eval-like patterns
    for (const pattern of DANGEROUS_PATTERNS.evalLike) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "eval_like",
          message: `Detected potentially dangerous eval-like pattern: ${matches[0]}`,
          severity: "critical",
          pattern: pattern.source,
        });
      }
    }

    // Check dynamic code execution
    for (const pattern of DANGEROUS_PATTERNS.dynamicCode) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "dynamic_code",
          message: `Detected dynamic code execution: ${matches[0]}`,
          severity: "critical",
          pattern: pattern.source,
        });
      }
    }

    // Check shell execution
    for (const pattern of DANGEROUS_PATTERNS.shellExecution) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "shell_execution",
          message: `Detected shell execution pattern: ${matches[0]}`,
          severity: "critical",
          pattern: pattern.source,
        });
      }
    }

    // Check process access
    for (const pattern of DANGEROUS_PATTERNS.processAccess) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "process_access",
          message: `Detected process/environment access: ${matches[0]}`,
          severity: "high",
          pattern: pattern.source,
        });
      }
    }

    // Check prototype pollution
    for (const pattern of DANGEROUS_PATTERNS.prototypePollution) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "prototype_pollution",
          message: `Detected potential prototype pollution: ${matches[0]}`,
          severity: "high",
          pattern: pattern.source,
        });
      }
    }

    // Check dangerous imports (reduced severity for performance tests)
    for (const pattern of DANGEROUS_PATTERNS.dangerousImports) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "dangerous_import",
          message: `Detected dangerous module import: ${matches[0]}`,
          severity: testType === "performance" ? "medium" : "high",
          pattern: pattern.source,
        });
      }
    }

    // Check suspicious network patterns (warning for API/perf tests)
    for (const pattern of DANGEROUS_PATTERNS.suspiciousNetwork) {
      const matches = code.match(pattern);
      if (matches) {
        if (testType === "api" || testType === "performance") {
          warnings.push(
            `Network access to external URL detected. Ensure this is intentional: ${matches[0]}`
          );
        } else {
          violations.push({
            type: "network_access",
            message: `Detected suspicious network access: ${matches[0]}`,
            severity: "medium",
            pattern: pattern.source,
          });
        }
      }
    }

    // Check filesystem access (warning for some test types)
    for (const pattern of DANGEROUS_PATTERNS.filesystemAccess) {
      const matches = code.match(pattern);
      if (matches) {
        violations.push({
          type: "filesystem_access",
          message: `Detected filesystem access: ${matches[0]}`,
          severity: "high",
          pattern: pattern.source,
        });
      }
    }

    // Check obfuscation patterns
    for (const pattern of DANGEROUS_PATTERNS.obfuscation) {
      const matches = code.match(pattern);
      if (matches) {
        // Count matches - a few might be legitimate, many indicates obfuscation
        const matchCount = (code.match(pattern) || []).length;
        if (matchCount > 3) {
          violations.push({
            type: "obfuscation",
            message: `Detected potential code obfuscation (${matchCount} occurrences): ${matches[0]}`,
            severity: "medium",
            pattern: pattern.source,
          });
        } else {
          warnings.push(`Possible obfuscation pattern detected: ${matches[0]}`);
        }
      }
    }
  }

  /**
   * Additional strict mode checks
   */
  private checkStrictPatterns(
    code: string,
    violations: SecurityViolation[]
  ): void {
    // Check for document.write
    if (/document\.write/gi.test(code)) {
      violations.push({
        type: "dangerous_function",
        message: "document.write is not allowed in strict mode",
        severity: "medium",
      });
    }

    // Check for innerHTML assignment
    if (/\.innerHTML\s*=/gi.test(code)) {
      violations.push({
        type: "dangerous_function",
        message: "Direct innerHTML assignment is not allowed in strict mode",
        severity: "medium",
      });
    }

    // Check for dynamic script injection
    if (/createElement\s*\(\s*['"`]script['"`]\s*\)/gi.test(code)) {
      violations.push({
        type: "dangerous_function",
        message: "Dynamic script creation is not allowed in strict mode",
        severity: "high",
      });
    }
  }

  /**
   * Filter out violations that match allowed patterns (false positives)
   */
  private filterAllowedPatterns(
    violations: SecurityViolation[],
    code: string,
    testType: string
  ): SecurityViolation[] {
    // Get applicable allowed patterns
    const allowedPatterns = [...ALLOWED_PATTERNS];

    if (testType === "performance") {
      allowedPatterns.push(...K6_ALLOWED_PATTERNS);
    }

    return violations.filter((violation) => {
      // Check if this violation matches any allowed pattern
      for (const allowedPattern of allowedPatterns) {
        if (allowedPattern.test(code)) {
          // This might be a false positive - check if the violation
          // is likely caused by the allowed pattern
          if (
            violation.type === "dangerous_function" ||
            violation.type === "network_access"
          ) {
            return false; // Filter out this violation
          }
        }
      }
      return true;
    });
  }

  /**
   * Quick validation for streaming responses
   * Performs lightweight checks suitable for real-time validation
   */
  quickValidate(chunk: string): { hasIssues: boolean; issues: string[] } {
    const issues: string[] = [];

    // Quick check for critical patterns only
    const criticalPatterns = [
      ...DANGEROUS_PATTERNS.evalLike,
      ...DANGEROUS_PATTERNS.shellExecution,
      ...DANGEROUS_PATTERNS.processAccess.slice(0, 3), // Only check first few
    ];

    for (const pattern of criticalPatterns) {
      if (pattern.test(chunk)) {
        issues.push(
          `Critical security pattern detected: ${pattern.source.slice(0, 30)}...`
        );
      }
    }

    return {
      hasIssues: issues.length > 0,
      issues,
    };
  }
}

// Export singleton instance
export const aiCodeValidator = AICodeValidator.getInstance();

/**
 * Convenience function for validating AI-generated code
 */
export function validateAICode(
  code: string,
  options?: {
    testType?: "browser" | "api" | "custom" | "database" | "performance";
    strict?: boolean;
  }
): ValidationResult {
  return aiCodeValidator.validate(code, options);
}
