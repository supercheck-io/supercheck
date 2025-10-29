// AI-driven error classification for determining fixability
export enum FailureCategory {
  // AI-Fixable Categories
  SELECTOR_ISSUES = "selector_issues", // Wrong/outdated selectors
  TIMING_PROBLEMS = "timing_problems", // Wait/timeout issues
  ASSERTION_FAILURES = "assertion_failures", // Expected vs actual mismatches
  NAVIGATION_ERRORS = "navigation_errors", // Routing/page load issues

  // Manual Investigation Required
  AUTHENTICATION_FAILURES = "authentication_failures", // Login/auth system issues
  PERMISSION_DENIED = "permission_denied", // Access control issues
  INFRASTRUCTURE_DOWN = "infrastructure_down", // Database, services unavailable
  DATA_ISSUES = "data_issues", // Missing/corrupt test data
  NETWORK_ISSUES = "network_issues", // Connectivity problems
  RESOURCE_CONSTRAINTS = "resource_constraints", // Memory, CPU, timeout limits

  // Unknown/Complex
  UNKNOWN = "unknown",
}

interface ErrorClassification {
  category: FailureCategory;
  confidence: number; // 0-1 scale
  aiFixable: boolean;
  keywords: string[];
  patterns: RegExp[];
  severity: "low" | "medium" | "high" | "critical";
}

interface MarkdownError {
  message: string;
  location: string;
  stackTrace?: string;
  classification?: ErrorClassification;
}

interface FixDecision {
  shouldAttemptFix: boolean;
  confidence: number;
  reasoning: string;
  recommendedAction: string;
  warningMessage?: string;
}

export class PlaywrightMarkdownParser {
  private static readonly ERROR_CLASSIFICATIONS: Record<
    FailureCategory,
    ErrorClassification
  > = {
    [FailureCategory.SELECTOR_ISSUES]: {
      category: FailureCategory.SELECTOR_ISSUES,
      confidence: 0.85,
      aiFixable: true,
      keywords: [
        "locator",
        "selector",
        "element",
        "not found",
        "visible",
        "clickable",
        "strict mode",
        "multiple elements",
      ],
      patterns: [
        /locator.*not found/i,
        /element.*not visible/i,
        /selector.*failed/i,
        /cannot locate element/i,
        /element not attached/i,
        /strict mode violation/i,
        /multiple.*elements/i,
        /element.*is.*not.*clickable/i,
        /waiting.*for.*element/i,
        /page\\..*\\(.*\\).*failed/i,
      ],
      severity: "medium",
    },

    [FailureCategory.TIMING_PROBLEMS]: {
      category: FailureCategory.TIMING_PROBLEMS,
      confidence: 0.8,
      aiFixable: true,
      keywords: [
        "timeout",
        "wait",
        "loading",
        "async",
        "race condition",
        "navigation",
      ],
      patterns: [
        /timeout.*exceeded/i,
        /waiting for.*timed out/i,
        /page\.waitFor.*timeout/i,
        /navigation timeout/i,
        /element not visible within timeout/i,
        /test.*timeout/i,
        /expect.*timeout/i,
        /page\\.waitFor/i,
      ],
      severity: "medium",
    },

    [FailureCategory.ASSERTION_FAILURES]: {
      category: FailureCategory.ASSERTION_FAILURES,
      confidence: 0.85,
      aiFixable: true,
      keywords: [
        "expect",
        "assert",
        "toBe",
        "toEqual",
        "mismatch",
        "toHaveTitle",
        "toHaveText",
        "title",
        "text",
      ],
      patterns: [
        /expected.*but received/i,
        /expected.*received/i,
        /assertion.*failed/i,
        /expect.*toBe.*received/i,
        /toHaveText.*actual/i,
        /toHaveTitle.*actual/i,
        /expected.*got/i,
        /title.*mismatch/i,
        /text.*mismatch/i,
        /Expected.*Received/i,
        /- Expected/i,
        /\+ Received/i,
      ],
      severity: "low",
    },

    [FailureCategory.NAVIGATION_ERRORS]: {
      category: FailureCategory.NAVIGATION_ERRORS,
      confidence: 0.7,
      aiFixable: true,
      keywords: ["navigation", "page", "url", "route", "redirect"],
      patterns: [
        /navigation.*failed/i,
        /page.*not found/i,
        /404.*error/i,
        /route.*not found/i,
        /unexpected.*url/i,
      ],
      severity: "medium",
    },

    [FailureCategory.NETWORK_ISSUES]: {
      category: FailureCategory.NETWORK_ISSUES,
      confidence: 0.9,
      aiFixable: false,
      keywords: [
        "network",
        "connection",
        "fetch",
        "request",
        "response",
        "500",
        "502",
        "503",
      ],
      patterns: [
        /network.*error/i,
        /connection.*refused/i,
        /fetch.*failed/i,
        /HTTP.*500/i,
        /HTTP.*502/i,
        /HTTP.*503/i,
        /gateway timeout/i,
      ],
      severity: "critical",
    },

    [FailureCategory.AUTHENTICATION_FAILURES]: {
      category: FailureCategory.AUTHENTICATION_FAILURES,
      confidence: 0.85,
      aiFixable: false,
      keywords: [
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "login",
        "authentication",
      ],
      patterns: [
        /HTTP.*401/i,
        /HTTP.*403/i,
        /unauthorized/i,
        /forbidden/i,
        /authentication.*failed/i,
        /invalid.*credentials/i,
        /session.*expired/i,
      ],
      severity: "high",
    },

    [FailureCategory.INFRASTRUCTURE_DOWN]: {
      category: FailureCategory.INFRASTRUCTURE_DOWN,
      confidence: 0.95,
      aiFixable: false,
      keywords: [
        "database",
        "server",
        "service",
        "down",
        "unavailable",
        "maintenance",
      ],
      patterns: [
        /database.*connection.*failed/i,
        /server.*unavailable/i,
        /service.*down/i,
        /maintenance.*mode/i,
        /could not connect to/i,
      ],
      severity: "critical",
    },

    [FailureCategory.RESOURCE_CONSTRAINTS]: {
      category: FailureCategory.RESOURCE_CONSTRAINTS,
      confidence: 0.8,
      aiFixable: false,
      keywords: ["memory", "cpu", "timeout", "resources", "limit"],
      patterns: [
        /out of memory/i,
        /resource.*exhausted/i,
        /cpu.*limit/i,
        /execution.*timeout/i,
        /process.*killed/i,
      ],
      severity: "high",
    },

    [FailureCategory.DATA_ISSUES]: {
      category: FailureCategory.DATA_ISSUES,
      confidence: 0.75,
      aiFixable: true, // AI can often suggest data validation fixes
      keywords: ["data", "missing", "corrupt", "invalid", "null", "undefined"],
      patterns: [
        /data.*not found/i,
        /missing.*data/i,
        /null.*reference/i,
        /undefined.*property/i,
        /invalid.*format/i,
      ],
      severity: "medium",
    },

    [FailureCategory.PERMISSION_DENIED]: {
      category: FailureCategory.PERMISSION_DENIED,
      confidence: 0.85,
      aiFixable: false,
      keywords: ["permission", "denied", "access", "rights", "privilege"],
      patterns: [
        /permission.*denied/i,
        /access.*denied/i,
        /insufficient.*rights/i,
        /privilege.*required/i,
        /not.*allowed/i,
      ],
      severity: "high",
    },

    [FailureCategory.UNKNOWN]: {
      category: FailureCategory.UNKNOWN,
      confidence: 0.6, // Increase confidence for unknown errors
      aiFixable: true, // Let AI attempt fixes for unknown errors
      keywords: [],
      patterns: [],
      severity: "medium",
    },
  };

  static parseMarkdownForErrors(markdownContent: string): MarkdownError[] {
    const errors: MarkdownError[] = [];

    try {
      // Extract error messages from markdown
      const errorSections = markdownContent.split(/^#+ /gm);

      for (const section of errorSections) {
        const lines = section.split("\n").filter((line) => line.trim());
        if (lines.length === 0) continue;

        // Look for error indicators (expanded for Playwright)
        const errorLines = lines.filter((line) => {
          const lowerLine = line.toLowerCase();
          return (
            lowerLine.includes("error:") ||
            lowerLine.includes("failed:") ||
            lowerLine.includes("✗") ||
            lowerLine.includes("assertion") ||
            lowerLine.includes("timeout") ||
            lowerLine.includes("exception") ||
            lowerLine.includes("locator") ||
            lowerLine.includes("element") ||
            lowerLine.includes("not found") ||
            lowerLine.includes("visible") ||
            lowerLine.includes("clicked") ||
            lowerLine.includes("expected") ||
            lowerLine.includes("received") ||
            lowerLine.includes("actual") ||
            lowerLine.includes("strict mode") ||
            lowerLine.includes("navigation") ||
            lowerLine.includes("mismatch") ||
            lowerLine.includes("toHaveTitle") ||
            lowerLine.includes("toHaveText") ||
            lowerLine.includes("toBe") ||
            lowerLine.includes("toEqual") ||
            lowerLine.includes("toContain") ||
            (line.includes("✓") && line.includes("[failed]")) ||
            /test.*failed/i.test(line) ||
            /expect.*to/i.test(line) ||
            /Expected.*but received/i.test(line) ||
            /Expected.*Received/i.test(line) ||
            /Call log:/i.test(line) ||
            (/^\s*- /i.test(line) &&
              (lowerLine.includes("expected") || lowerLine.includes("actual")))
          );
        });

        for (const errorLine of errorLines) {
          const error: MarkdownError = {
            message: errorLine.trim(),
            location: this.extractLocation(section) || "Unknown",
            stackTrace: this.extractStackTrace(section),
            classification: this.classifyError(errorLine),
          };

          errors.push(error);
        }
      }

      // If no specific errors found, create a general error from content
      if (errors.length === 0 && markdownContent.trim()) {
        // Try to extract any meaningful content for a fallback error
        const contentLines = markdownContent
          .split("\n")
          .filter((line) => line.trim());
        const meaningfulContent =
          contentLines.find(
            (line) =>
              line.length > 10 &&
              (line.includes("test") ||
                line.includes("expect") ||
                line.includes("fail"))
          ) || "Test execution completed with unspecified failure";

        const fallbackError: MarkdownError = {
          message: meaningfulContent,
          location: "Unknown",
          stackTrace: undefined,
          classification: {
            ...this.ERROR_CLASSIFICATIONS[FailureCategory.UNKNOWN],
            category: FailureCategory.UNKNOWN,
            aiFixable: true, // Let AI attempt to fix unknown issues
            confidence: 0.6, // Moderate confidence for unknown issues
          },
        };
        errors.push(fallbackError);
      }
    } catch (parseError) {
      // Fallback error if parsing completely fails
      errors.push({
        message: `Markdown parsing failed: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`,
        location: "Parser",
        classification: this.ERROR_CLASSIFICATIONS[FailureCategory.UNKNOWN],
      });
    }

    return errors;
  }

  private static extractLocation(section: string): string | undefined {
    const locationMatch = section.match(/at (.*?):\d+:\d+/);
    return locationMatch ? locationMatch[1] : undefined;
  }

  private static extractStackTrace(section: string): string | undefined {
    const stackMatch = section.match(
      /(?:Stack trace|Call stack):\s*([\s\S]*?)(?:\n\n|\n#|$)/
    );
    return stackMatch ? stackMatch[1].trim() : undefined;
  }

  private static classifyError(errorMessage: string): ErrorClassification {
    const lowerMessage = errorMessage.toLowerCase();

    // Score each classification
    const scores: Array<{
      classification: ErrorClassification;
      score: number;
    }> = [];

    for (const classification of Object.values(this.ERROR_CLASSIFICATIONS)) {
      let score = 0;

      // Keyword matching
      for (const keyword of classification.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      // Pattern matching (higher weight)
      for (const pattern of classification.patterns) {
        if (pattern.test(errorMessage)) {
          score += 3;
        }
      }

      scores.push({ classification, score });
    }

    // Return highest scoring classification
    const best = scores.sort((a, b) => b.score - a.score)[0];
    return best && best.score > 0
      ? best.classification
      : this.ERROR_CLASSIFICATIONS[FailureCategory.UNKNOWN];
  }
}

export class AIFixDecisionEngine {
  static shouldAttemptMarkdownFix(errors: MarkdownError[]): FixDecision {
    if (errors.length === 0) {
      return {
        shouldAttemptFix: false,
        confidence: 0,
        reasoning: "No errors found in markdown report",
        recommendedAction: "Review test execution logs for issues",
        warningMessage: "Unable to analyze failure without error details",
      };
    }

    // Analyze error categories
    const classifications = errors
      .map((e) => e.classification)
      .filter(Boolean) as ErrorClassification[];
    const aiFixableErrors = classifications.filter((c) => c.aiFixable);
    const nonFixableErrors = classifications.filter((c) => !c.aiFixable);

    // Decision logic
    if (aiFixableErrors.length === 0) {
      const primaryError = classifications[0];
      return {
        shouldAttemptFix: false,
        confidence: primaryError?.confidence || 0.5,
        reasoning: this.getReasoningForCategory(
          primaryError?.category || FailureCategory.UNKNOWN
        ),
        recommendedAction: this.getRecommendationForCategory(
          primaryError?.category || FailureCategory.UNKNOWN
        ),
        warningMessage:
          "This issue requires manual investigation rather than code changes",
      };
    }

    // Calculate overall confidence
    const totalConfidence =
      aiFixableErrors.reduce((sum, c) => sum + c.confidence, 0) /
      aiFixableErrors.length;

    // High confidence threshold for automatic fixing
    if (totalConfidence >= 0.6 && nonFixableErrors.length === 0) {
      return {
        shouldAttemptFix: true,
        confidence: totalConfidence,
        reasoning: `High confidence AI fix available for ${aiFixableErrors
          .map((e) => e.category)
          .join(", ")}`,
        recommendedAction: "Generate AI fix and review changes",
      };
    }

    // Medium confidence - still attempt but with warning
    if (totalConfidence >= 0.4) {
      return {
        shouldAttemptFix: true,
        confidence: totalConfidence,
        reasoning: `Moderate confidence AI fix for ${aiFixableErrors.length} fixable issues`,
        recommendedAction: "Generate AI fix but carefully review changes",
        warningMessage: "Review AI suggestions carefully before applying",
      };
    }

    // Low confidence - don't attempt
    return {
      shouldAttemptFix: false,
      confidence: totalConfidence,
      reasoning:
        "Low confidence in AI fix success due to complex error patterns",
      recommendedAction: "Manual debugging recommended for this issue",
      warningMessage: "This issue appears too complex for automated fixing",
    };
  }

  private static getReasoningForCategory(category: FailureCategory): string {
    switch (category) {
      case FailureCategory.NETWORK_ISSUES:
        return "Network connectivity problem. This requires infrastructure investigation, not script changes.";
      case FailureCategory.AUTHENTICATION_FAILURES:
        return "Authentication system issue. Check credentials, user permissions, or authentication service status.";
      case FailureCategory.INFRASTRUCTURE_DOWN:
        return "Service or database unavailability. Contact system administrators or wait for service restoration.";
      case FailureCategory.DATA_ISSUES:
        return "Test data missing or corrupted. Verify test data setup and database state.";
      case FailureCategory.RESOURCE_CONSTRAINTS:
        return "System resource limitations. Increase timeouts, memory limits, or optimize test execution.";
      case FailureCategory.PERMISSION_DENIED:
        return "Access control issue. Verify user permissions and system configuration.";
      case FailureCategory.TIMING_PROBLEMS:
        return "Timing issue detected. AI can suggest proper wait conditions or timeout adjustments.";
      default:
        return "Error classification available with detailed analysis.";
    }
  }

  private static getRecommendationForCategory(
    category: FailureCategory
  ): string {
    switch (category) {
      case FailureCategory.NETWORK_ISSUES:
        return "Check network connectivity, service endpoints, and server status.";
      case FailureCategory.AUTHENTICATION_FAILURES:
        return "Verify user credentials, session state, and authentication service availability.";
      case FailureCategory.INFRASTRUCTURE_DOWN:
        return "Contact system administrators and check service status dashboards.";
      case FailureCategory.DATA_ISSUES:
        return "Verify test data integrity and database connectivity.";
      case FailureCategory.RESOURCE_CONSTRAINTS:
        return "Review system resources, increase limits, or optimize test execution.";
      case FailureCategory.PERMISSION_DENIED:
        return "Check user permissions, roles, and access control configuration.";
      default:
        return "Environmental issue detected. Review infrastructure and configuration.";
    }
  }
}
