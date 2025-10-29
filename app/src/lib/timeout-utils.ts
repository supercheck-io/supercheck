export interface TimeoutErrorInfo {
  isTimeout: boolean;
  timeoutType: "test" | "job" | "unknown";
  timeoutDurationMs: number;
  timeoutDurationMinutes: number;
}

/**
 * Detects if an error message indicates a timeout and extracts timeout information
 */
export function detectTimeoutError(
  errorMessage: string | null | undefined,
  stderr: string | null | undefined = "",
  stdout: string | null | undefined = ""
): TimeoutErrorInfo {
  const defaultResult: TimeoutErrorInfo = {
    isTimeout: false,
    timeoutType: "unknown",
    timeoutDurationMs: 0,
    timeoutDurationMinutes: 0,
  };

  if (!errorMessage && !stderr && !stdout) {
    return defaultResult;
  }

  // Combine all potential error sources
  const combinedErrorText = [errorMessage, stderr, stdout]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Check for timeout patterns
  const timeoutPatterns = [
    /execution timed out after (\d+)ms/,
    /timed out after (\d+)ms/,
    /timed out after ([^s]+)ms/, // handles malformed durations like "abcms"
    /timeout after (\d+)ms/,
    /execution timeout/,
    /\[execution timeout\]/,
  ];

  for (const pattern of timeoutPatterns) {
    const match = combinedErrorText.match(pattern);
    if (match) {
      let timeoutMs = 0;

      // Extract timeout duration if captured
      if (match[1]) {
        const parsedTimeout = parseInt(match[1], 10);
        timeoutMs = isNaN(parsedTimeout) ? 0 : parsedTimeout;
      } else {
        // Try to infer from known timeout values
        if (
          combinedErrorText.includes("120000ms") ||
          combinedErrorText.includes("120000")
        ) {
          timeoutMs = 120000; // 2 minutes - test timeout
        } else if (
          combinedErrorText.includes("900000ms") ||
          combinedErrorText.includes("900000")
        ) {
          timeoutMs = 900000; // 15 minutes - job timeout
        }
      }

      const timeoutMinutes = Math.floor(timeoutMs / 60000);

      // Determine timeout type based on duration
      let timeoutType: "test" | "job" | "unknown" = "unknown";
      if (timeoutMs === 120000) {
        timeoutType = "test"; // 2 minutes
      } else if (timeoutMs === 900000) {
        timeoutType = "job"; // 15 minutes
      } else if (timeoutMs > 0 && timeoutMinutes <= 2) {
        timeoutType = "test"; // Assume test if ≤ 2 minutes
      } else if (timeoutMs > 0 && timeoutMinutes >= 10) {
        timeoutType = "job"; // Assume job if ≥ 10 minutes
      }

      return {
        isTimeout: true,
        timeoutType,
        timeoutDurationMs: timeoutMs,
        timeoutDurationMinutes: timeoutMinutes,
      };
    }
  }

  return defaultResult;
}

/**
 * Gets user-friendly timeout error messages
 */
export function getTimeoutErrorMessages(timeoutInfo: TimeoutErrorInfo) {
  if (!timeoutInfo.isTimeout) {
    return {
      title: "Execution Failed",
      message: "The execution encountered an error.",
      suggestion: "Please check your script and try again.",
    };
  }

  const minutes =
    timeoutInfo.timeoutDurationMinutes ||
    (timeoutInfo.timeoutType === "test" ? 2 : 15);

  if (timeoutInfo.timeoutType === "test") {
    return {
      title: "Test Execution Timeout",
      message: `Your test script timed out after ${minutes} minute${
        minutes !== 1 ? "s" : ""
      }.`,
      suggestion:
        "Review your script for infinite loops, slow network requests, or missing waits. Optimize selector strategies, use explicit waits over hard delays, and consider splitting or simplifying complex tests.",
    };
  } else if (timeoutInfo.timeoutType === "job") {
    return {
      title: "Job Execution Timeout",
      message: `Your job execution timed out after ${minutes} minute${
        minutes !== 1 ? "s" : ""
      }.`,
      suggestion:
        "Review your job for infinite loops, slow network requests, or missing waits. Optimize selectors, prefer explicit waits over hard delays, simplify complex tests, and consider splitting large test suites or optimizing resource-heavy operations.",
    };
  } else {
    return {
      title: "Execution Timeout",
      message: `The execution timed out after ${minutes} minute${
        minutes !== 1 ? "s" : ""
      }.`,
      suggestion:
        "Please review your script for performance issues and try again.",
    };
  }
}

/**
 * Gets timeout-specific action recommendations
 */
export function getTimeoutActions(timeoutInfo: TimeoutErrorInfo) {
  const baseActions = [
    "Review your script for infinite loops",
    "Check for slow network requests",
    "Optimize selector strategies",
  ];

  if (timeoutInfo.timeoutType === "test") {
    return [
      ...baseActions,
      "Add explicit waits instead of hard delays",
      "Reduce test complexity",
      "Consider splitting complex tests",
    ];
  } else if (timeoutInfo.timeoutType === "job") {
    return [
      ...baseActions,
      "Break down large test suites",
      "Optimize test execution order",
      "Review parallel execution settings",
      "Consider test suite organization",
    ];
  } else {
    return baseActions;
  }
}
