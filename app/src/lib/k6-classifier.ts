/**
 * K6 Performance Test Error Classification System
 *
 * This module provides intelligent classification of K6 performance test failures
 * to determine if they can be fixed by AI or require manual investigation.
 */

export enum K6FailureCategory {
  // AI-Fixable Categories (4 types)
  SCRIPT_ERRORS = "script_errors",           // JavaScript/syntax errors in the script
  HTTP_REQUEST_ISSUES = "http_request_issues", // Incorrect HTTP methods, headers, or payloads
  THRESHOLD_FAILURES = "threshold_failures", // Performance thresholds not met
  INCORRECT_ASSERTIONS = "incorrect_assertions", // Wrong checks or assertions

  // Manual Investigation Required (6 types)
  NETWORK_ISSUES = "network_issues",         // Network connectivity problems
  AUTHENTICATION_FAILURES = "authentication_failures", // Auth/credential issues
  SERVER_ERRORS = "server_errors",           // 5xx server errors
  RATE_LIMITING = "rate_limiting",           // API rate limiting hit
  INFRASTRUCTURE_DOWN = "infrastructure_down", // Target service unavailable
  RESOURCE_CONSTRAINTS = "resource_constraints", // Memory/CPU/timeout issues

  UNKNOWN = "unknown",
}

interface K6ErrorClassification {
  category: K6FailureCategory;
  confidence: number;
  aiFixable: boolean;
  keywords: string[];
  patterns: RegExp[];
  severity: "low" | "medium" | "high" | "critical";
}

export class K6ErrorClassifier {
  private static readonly classifications: Record<K6FailureCategory, K6ErrorClassification> = {
    [K6FailureCategory.SCRIPT_ERRORS]: {
      category: K6FailureCategory.SCRIPT_ERRORS,
      confidence: 0.95,
      aiFixable: true,
      keywords: [
        "SyntaxError",
        "ReferenceError",
        "TypeError",
        "undefined is not a function",
        "unexpected token",
        "cannot read property",
      ],
      patterns: [
        /SyntaxError:/i,
        /ReferenceError:/i,
        /TypeError:/i,
        /undefined.*function/i,
        /unexpected\s+token/i,
      ],
      severity: "high",
    },
    [K6FailureCategory.HTTP_REQUEST_ISSUES]: {
      category: K6FailureCategory.HTTP_REQUEST_ISSUES,
      confidence: 0.9,
      aiFixable: true,
      keywords: [
        "invalid request",
        "malformed",
        "bad request",
        "400",
        "method not allowed",
        "405",
        "unsupported media type",
        "415",
      ],
      patterns: [
        /invalid\s+request/i,
        /malformed.*request/i,
        /400\s+bad\s+request/i,
        /405\s+method\s+not\s+allowed/i,
        /415\s+unsupported/i,
      ],
      severity: "medium",
    },
    [K6FailureCategory.THRESHOLD_FAILURES]: {
      category: K6FailureCategory.THRESHOLD_FAILURES,
      confidence: 0.85,
      aiFixable: true,
      keywords: [
        "threshold",
        "exceeded",
        "failed",
        "p95",
        "p99",
        "duration",
        "response time",
      ],
      patterns: [
        /threshold.*failed/i,
        /threshold.*exceeded/i,
        /p9[59].*exceeded/i,
        /duration.*threshold/i,
      ],
      severity: "medium",
    },
    [K6FailureCategory.INCORRECT_ASSERTIONS]: {
      category: K6FailureCategory.INCORRECT_ASSERTIONS,
      confidence: 0.9,
      aiFixable: true,
      keywords: [
        "check failed",
        "assertion failed",
        "expected",
        "but got",
        "status code",
      ],
      patterns: [
        /check.*failed/i,
        /assertion.*failed/i,
        /expected.*but\s+got/i,
        /status\s+code.*expected/i,
      ],
      severity: "medium",
    },
    [K6FailureCategory.NETWORK_ISSUES]: {
      category: K6FailureCategory.NETWORK_ISSUES,
      confidence: 0.95,
      aiFixable: false,
      keywords: [
        "network",
        "connection refused",
        "timeout",
        "ECONNREFUSED",
        "ETIMEDOUT",
        "DNS",
      ],
      patterns: [
        /network.*error/i,
        /connection\s+refused/i,
        /ECONNREFUSED/,
        /ETIMEDOUT/,
        /DNS.*fail/i,
        /request\s+timeout/i,
      ],
      severity: "critical",
    },
    [K6FailureCategory.AUTHENTICATION_FAILURES]: {
      category: K6FailureCategory.AUTHENTICATION_FAILURES,
      confidence: 0.95,
      aiFixable: false,
      keywords: [
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "authentication",
        "credentials",
      ],
      patterns: [
        /401\s+unauthorized/i,
        /403\s+forbidden/i,
        /authentication.*fail/i,
        /invalid.*credentials/i,
      ],
      severity: "high",
    },
    [K6FailureCategory.SERVER_ERRORS]: {
      category: K6FailureCategory.SERVER_ERRORS,
      confidence: 0.95,
      aiFixable: false,
      keywords: [
        "500",
        "502",
        "503",
        "504",
        "internal server error",
        "bad gateway",
        "service unavailable",
      ],
      patterns: [
        /50[0-9]\s+/i,
        /internal\s+server\s+error/i,
        /bad\s+gateway/i,
        /service\s+unavailable/i,
      ],
      severity: "critical",
    },
    [K6FailureCategory.RATE_LIMITING]: {
      category: K6FailureCategory.RATE_LIMITING,
      confidence: 0.95,
      aiFixable: false,
      keywords: [
        "429",
        "too many requests",
        "rate limit",
        "quota exceeded",
      ],
      patterns: [
        /429\s+too\s+many\s+requests/i,
        /rate\s+limit/i,
        /quota\s+exceeded/i,
      ],
      severity: "medium",
    },
    [K6FailureCategory.INFRASTRUCTURE_DOWN]: {
      category: K6FailureCategory.INFRASTRUCTURE_DOWN,
      confidence: 0.9,
      aiFixable: false,
      keywords: [
        "service unavailable",
        "host not found",
        "cannot reach",
        "unreachable",
      ],
      patterns: [
        /service\s+unavailable/i,
        /host.*not\s+found/i,
        /cannot\s+reach/i,
        /unreachable/i,
      ],
      severity: "critical",
    },
    [K6FailureCategory.RESOURCE_CONSTRAINTS]: {
      category: K6FailureCategory.RESOURCE_CONSTRAINTS,
      confidence: 0.85,
      aiFixable: false,
      keywords: [
        "out of memory",
        "memory limit",
        "cpu",
        "execution time limit",
        "killed",
      ],
      patterns: [
        /out\s+of\s+memory/i,
        /memory.*limit/i,
        /execution.*limit/i,
        /process.*killed/i,
      ],
      severity: "critical",
    },
    [K6FailureCategory.UNKNOWN]: {
      category: K6FailureCategory.UNKNOWN,
      confidence: 0.5,
      aiFixable: false,
      keywords: [],
      patterns: [],
      severity: "medium",
    },
  };

  /**
   * Classify a K6 error message
   */
  static classifyError(errorMessage: string): K6ErrorClassification {
    const lowerMessage = errorMessage.toLowerCase();

    for (const classification of Object.values(this.classifications)) {
      // Check keyword matches
      const keywordMatch = classification.keywords.some((keyword) =>
        lowerMessage.includes(keyword.toLowerCase())
      );

      // Check pattern matches
      const patternMatch = classification.patterns.some((pattern) =>
        pattern.test(errorMessage)
      );

      if (keywordMatch || patternMatch) {
        return classification;
      }
    }

    return this.classifications[K6FailureCategory.UNKNOWN];
  }
}

export class K6LogParser {
  /**
   * Parse K6 console log for errors
   */
  static parseConsoleLog(logContent: string): Array<{
    message: string;
    location: string;
    classification?: K6ErrorClassification;
  }> {
    const errors: Array<{
      message: string;
      location: string;
      classification?: K6ErrorClassification;
    }> = [];

    const lines = logContent.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for error indicators
      if (
        line.includes("✗") ||
        line.includes("ERRO") ||
        line.includes("Error:") ||
        line.includes("failed")
      ) {
        const message = line.trim();
        const classification = K6ErrorClassifier.classifyError(message);

        errors.push({
          message,
          location: `line ${i + 1}`,
          classification,
        });
      }
    }

    return errors;
  }

  /**
   * Parse K6 summary.json for threshold failures
   */
  static parseSummaryJSON(summaryContent: string): Array<{
    message: string;
    location: string;
    classification?: K6ErrorClassification;
  }> {
    const errors: Array<{
      message: string;
      location: string;
      classification?: K6ErrorClassification;
    }> = [];

    try {
      const summary = JSON.parse(summaryContent);

      // Check for threshold failures
      if (summary.metrics) {
        for (const [metricName, metricData] of Object.entries(summary.metrics)) {
          const metric = metricData as { thresholds?: Record<string, { ok: boolean }> };
          if (metric.thresholds) {
            for (const [thresholdName, thresholdData] of Object.entries(metric.thresholds)) {
              if (!thresholdData.ok) {
                const message = `Threshold failed: ${metricName} - ${thresholdName}`;
                const classification = K6ErrorClassifier.classifyError(message);

                errors.push({
                  message,
                  location: "threshold",
                  classification,
                });
              }
            }
          }
        }
      }

      // Check for root group checks
      if (summary.root_group && summary.root_group.checks) {
        for (const check of summary.root_group.checks) {
          if (check.fails && check.fails > 0) {
            const message = `Check failed: ${check.name} (${check.fails} failures)`;
            const classification = K6ErrorClassifier.classifyError(message);

            errors.push({
              message,
              location: "check",
              classification,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error parsing K6 summary JSON:", error);
    }

    return errors;
  }
}

export class K6FixDecisionEngine {
  /**
   * Determine if AI should attempt to fix K6 script based on error classifications
   */
  static shouldAttemptFix(
    errorClassifications: Array<{
      message: string;
      location: string;
      classification?: K6ErrorClassification;
    }>
  ): {
    shouldAttemptFix: boolean;
    confidence: number;
    fixableErrors: number;
    totalErrors: number;
    reasons: string[];
  } {
    const totalErrors = errorClassifications.length;

    if (totalErrors === 0) {
      return {
        shouldAttemptFix: false,
        confidence: 0,
        fixableErrors: 0,
        totalErrors: 0,
        reasons: ["No errors detected"],
      };
    }

    const fixableErrors = errorClassifications.filter(
      (ec) => ec.classification?.aiFixable
    );

    const nonFixableErrors = errorClassifications.filter(
      (ec) => !ec.classification?.aiFixable
    );

    // If all errors are non-fixable, don't attempt fix
    if (fixableErrors.length === 0) {
      return {
        shouldAttemptFix: false,
        confidence: 0,
        fixableErrors: 0,
        totalErrors,
        reasons: nonFixableErrors.map(
          (ec) => `${ec.classification?.category}: ${ec.message}`
        ),
      };
    }

    // Calculate confidence based on fixable error ratio
    const fixableRatio = fixableErrors.length / totalErrors;
    const avgConfidence =
      fixableErrors.reduce((sum, ec) => sum + (ec.classification?.confidence || 0), 0) /
      fixableErrors.length;

    const confidence = fixableRatio * avgConfidence;

    return {
      shouldAttemptFix: confidence > 0.6, // Only attempt if confidence > 60%
      confidence,
      fixableErrors: fixableErrors.length,
      totalErrors,
      reasons: fixableErrors.map(
        (ec) => `${ec.classification?.category}: ${ec.message}`
      ),
    };
  }
}
