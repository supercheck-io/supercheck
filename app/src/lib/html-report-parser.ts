// HTML report parser for extracting test failure information
import { JSDOM } from "jsdom";

export interface ExtractedTestError {
  message: string;
  details: string;
  lineNumber?: number;
  testName: string;
  stackTrace?: string;
  source: "html" | "markdown";
}

export interface ParsedHTMLReport {
  errors: ExtractedTestError[];
  testName: string;
  duration: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  browser?: string;
  totalTests: number;
  failedTests: number;
}

export class HTMLReportParser {
  /**
   * Parse HTML report content to extract error information
   * This serves as fallback when markdown reports are not available (API/DB tests)
   */
  static async parseHTMLReport(htmlContent: string): Promise<ParsedHTMLReport> {
    try {
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;

      // Extract basic test information
      const testName = this.extractTestName(document);
      const duration = this.extractTestDuration(document);
      const status = this.extractTestStatus(document);
      const browser = this.extractBrowserInfo(document);
      const { totalTests, failedTests } = this.extractTestCounts(document);

      // Extract error information
      const errors = this.extractErrors(document, testName);

      return {
        errors,
        testName,
        duration,
        status,
        browser,
        totalTests,
        failedTests,
      };
    } catch (error) {
      console.error("Failed to parse HTML report:", error);
      throw new Error(
        `HTML report parsing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Extract test name from HTML report
   */
  private static extractTestName(document: Document): string {
    // Try different selectors for test name
    const selectors = [
      "h1", // Main heading
      ".test-title",
      '[data-testid="test-title"]',
      ".test-name",
      ".suite-title",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    // Fallback to page title
    const title = document.querySelector("title");
    return title?.textContent?.trim() || "Unknown Test";
  }

  /**
   * Extract test duration from HTML report
   */
  private static extractTestDuration(document: Document): string {
    // Look for duration information
    const durationSelectors = [
      ".test-duration",
      ".duration",
      '[data-testid="duration"]',
    ];

    for (const selector of durationSelectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }

    // Try to extract from text content
    const bodyText = document.body?.textContent || "";
    const durationMatch = bodyText.match(
      /(\d+\.?\d*)\s*(ms|s|seconds?|minutes?)/i
    );
    return durationMatch ? durationMatch[0] : "Unknown";
  }

  /**
   * Extract test status from HTML report
   */
  private static extractTestStatus(
    document: Document
  ): "passed" | "failed" | "skipped" | "flaky" {
    const bodyText = document.body?.textContent?.toLowerCase() || "";

    // Check for status indicators
    if (bodyText.includes("failed") || bodyText.includes("error")) {
      return "failed";
    }
    if (bodyText.includes("skipped")) {
      return "skipped";
    }
    if (bodyText.includes("flaky")) {
      return "flaky";
    }
    if (bodyText.includes("passed") || bodyText.includes("success")) {
      return "passed";
    }

    // Check status classes or attributes
    const statusElement = document.querySelector(
      ".status, [data-status], .test-status"
    );
    if (statusElement) {
      const status =
        statusElement.textContent?.toLowerCase() ||
        statusElement.getAttribute("data-status")?.toLowerCase() ||
        statusElement.className.toLowerCase();

      if (status.includes("fail")) return "failed";
      if (status.includes("pass")) return "passed";
      if (status.includes("skip")) return "skipped";
      if (status.includes("flaky")) return "flaky";
    }

    return "failed"; // Default to failed if we can't determine
  }

  /**
   * Extract browser information from HTML report
   */
  private static extractBrowserInfo(document: Document): string | undefined {
    const bodyText = document.body?.textContent || "";

    // Look for browser mentions
    const browserMatch = bodyText.match(
      /(chromium|chrome|firefox|webkit|safari|edge)/i
    );
    return browserMatch ? browserMatch[1] : undefined;
  }

  /**
   * Extract test counts from HTML report
   */
  private static extractTestCounts(document: Document): {
    totalTests: number;
    failedTests: number;
  } {
    const bodyText = document.body?.textContent || "";

    // Try to extract test counts
    const allMatch = bodyText.match(/All\s+(\d+)/i);
    const failedMatch = bodyText.match(/Failed\s+(\d+)/i);

    const totalTests = allMatch ? parseInt(allMatch[1]) : 1;
    const failedTests = failedMatch ? parseInt(failedMatch[1]) : 1; // Default to 1 if we're parsing a failure report

    return { totalTests, failedTests };
  }

  /**
   * Extract error information from HTML report
   */
  private static extractErrors(
    document: Document,
    testName: string
  ): ExtractedTestError[] {
    const errors: ExtractedTestError[] = [];

    // Look for error sections with expanded selectors for Playwright reports
    const errorSelectors = [
      ".error",
      ".failure",
      ".test-error",
      '[data-testid="error"]',
      ".errors",
      ".call-log",
      ".test-result-error",
      ".playwright-error",
      ".step-error",
      ".attachment-body", // Playwright attachments often contain error details
      "pre", // Playwright often uses pre tags for error output
      "code", // Code blocks may contain stack traces
      '[class*="error"]', // Any class containing "error"
      '[class*="fail"]', // Any class containing "fail"
      ".test-case", // Playwright test case containers
      ".test-step", // Individual test steps
      ".result-item", // Result containers
      ".step", // Step elements
      "[data-test-id]", // Data test id elements
      "[data-testid]", // Alternative data test id
      ".call", // Call elements
      ".test-result", // Test result containers
    ];

    for (const selector of errorSelectors) {
      const errorElements = document.querySelectorAll(selector);

      errorElements.forEach((element) => {
        const textContent = element.textContent?.trim();
        if (textContent && textContent.length > 10) {
          // Avoid short/empty text
          const error = this.parseErrorElement(element, testName);
          if (error) {
            errors.push(error);
          }
        }
      });
    }

    // Enhanced body text parsing for common Playwright error patterns - MORE AGGRESSIVE
    if (errors.length === 0) {
      const bodyText = document.body?.textContent || "";
      const innerHTML = document.body?.innerHTML || "";

      // Check if it's a proper Playwright report by looking for structural elements
      const playwrightStructure = {
        hasDataTestId: innerHTML.includes("data-testid"),
        hasTestCases:
          innerHTML.includes("test-case") || innerHTML.includes("testcase"),
        hasTestResults:
          innerHTML.includes("test-result") || innerHTML.includes("result"),
        hasSteps: innerHTML.includes("step") || innerHTML.includes("call"),
        hasAttachments: innerHTML.includes("attachment"),
        hasReportData:
          innerHTML.includes("report-data") || innerHTML.includes("data"),
        hasFailureClass:
          innerHTML.includes("failed") || innerHTML.includes("error"),
        hasScript: innerHTML.includes("<script"),
        hasPlaywrightTitle:
          bodyText.toLowerCase().includes("playwright") &&
          bodyText.toLowerCase().includes("report"),
      };

      // More comprehensive error patterns for Playwright reports
      const errorPatterns = [
        /Error:/i,
        /TimeoutError:/i,
        /Failed:/i,
        /AssertionError:/i,
        /TypeError:/i,
        /ReferenceError:/i,
        /Test timeout/i,
        /expect\(.*?\)\.(not\.)?to/i,
        /locator.*not found/i,
        /waiting for selector/i,
        /element is not.*visible/i,
        /response status.*not ok/i,
        /Test failed/i,
        /test\.spec\./i, // Playwright test file references
        /at .*\.spec\./i, // Stack trace references to spec files
        /expected.*received/i, // Jest-style assertion failures
        /toHaveText/i,
        /toBeVisible/i,
        /toBeEnabled/i,
        /toContainText/i,
        /toHaveValue/i,
        /Locator\.click:/i,
        /Locator\.fill:/i,
        /page\.goto:/i,
        /Navigation timeout/i,
        /Execution context was destroyed/i,
        /net::ERR_/i,
        /Protocol error/i,
        /Target closed/i,
        // Additional patterns for modern Playwright reports
        /page\.waitForSelector/i,
        /element\.click/i,
        /element\.fill/i,
        /screenshot/i,
        /trace/i,
      ];

      let foundError = false;
      for (const pattern of errorPatterns) {
        if (pattern.test(bodyText)) {
          foundError = true;
          break;
        }
      }

      // Even more aggressive - check for any test failure indicators
      if (!foundError) {
        const failureIndicators = [
          "✗",
          "×",
          "FAIL",
          "fail",
          "Failed",
          "ERROR",
          "Exception",
        ];
        for (const indicator of failureIndicators) {
          if (bodyText.includes(indicator)) {
            foundError = true;
            break;
          }
        }
      }

      if (
        foundError ||
        bodyText.toLowerCase().includes("✗") ||
        bodyText.toLowerCase().includes("failed")
      ) {
        // Try to extract specific error lines more aggressively
        const lines = bodyText.split("\n");

        const errorLines = lines.filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed.length > 0 &&
            (/Error:/i.test(trimmed) ||
              /Failed:/i.test(trimmed) ||
              /Timeout/i.test(trimmed) ||
              /expect/i.test(trimmed) ||
              /✗/.test(trimmed) ||
              /×/.test(trimmed) ||
              /FAIL/i.test(trimmed) ||
              /Exception/i.test(trimmed) ||
              /at .*\.spec\./i.test(trimmed) ||
              /Test timeout/i.test(trimmed) ||
              /locator/i.test(trimmed) ||
              /toHave/i.test(trimmed) ||
              /toBe/i.test(trimmed))
          );
        });

        // Extract multiple error messages if available
        if (errorLines.length > 0) {
          errorLines.slice(0, 5).forEach((line) => {
            // Limit to first 5 errors
            const message = this.extractErrorMessage(line);
            if (message && message.length > 5) {
              errors.push({
                message: message,
                details: this.truncateText(
                  this.extractContextAroundLine(lines, lines.indexOf(line)),
                  1500
                ),
                testName,
                source: "html",
                lineNumber: lines.indexOf(line) + 1,
              });
            }
          });
        } else {
          // Last resort - create a general error from body text
          const fallbackMessage = this.extractFallbackErrorMessage(bodyText);

          errors.push({
            message: fallbackMessage,
            details: this.truncateText(bodyText, 2000),
            testName,
            source: "html",
          });
        }
      } else {
        // Ultimate fallback - if it's a Playwright report but we can't find errors,
        // check if it's a JavaScript-heavy report that needs DOM parsing
        if (
          playwrightStructure.hasScript &&
          playwrightStructure.hasPlaywrightTitle
        ) {

          // Try to extract from script tags that might contain test data
          const scriptElements = document.querySelectorAll("script");
          let scriptContent = "";

          scriptElements.forEach((script) => {
            const content = script.textContent || "";
            if (
              content.includes("test") ||
              content.includes("error") ||
              content.includes("fail")
            ) {
              scriptContent += content + "\n";
            }
          });

          if (scriptContent.length > 100) {
            // Parse the script content for error information
            const scriptErrorMessage =
              this.extractErrorFromScript(scriptContent);
            if (scriptErrorMessage) {
              errors.push({
                message: scriptErrorMessage,
                details: this.truncateText(scriptContent, 1500),
                testName: testName + " (from script)",
                source: "html",
              });
            }
          }
        }

        // If still no errors found, force create a generic error for failed tests
        if (
          errors.length === 0 &&
          (bodyText.toLowerCase().includes("failed") ||
            bodyText.toLowerCase().includes("error") ||
            innerHTML.includes("failed") ||
            innerHTML.includes("error"))
        ) {
          errors.push({
            message:
              "Test failed - specific error details not extracted from HTML report",
            details: this.truncateText(
              bodyText.length > innerHTML.length ? bodyText : innerHTML,
              2000
            ),
            testName,
            source: "html",
          });
        }
      }
    }

    return errors;
  }

  /**
   * Parse individual error element
   */
  private static parseErrorElement(
    element: Element,
    testName: string
  ): ExtractedTestError | null {
    const textContent = element.textContent?.trim() || "";

    if (textContent.length < 10) {
      return null; // Skip short/empty content
    }

    // Extract error message
    const message = this.extractErrorMessage(textContent);

    // Extract line number if present
    const lineMatch = textContent.match(/line\s+(\d+)|:(\d+):/i);
    const lineNumber = lineMatch
      ? parseInt(lineMatch[1] || lineMatch[2])
      : undefined;

    // Extract stack trace
    const stackTrace = this.extractStackTrace(textContent);

    return {
      message,
      details: this.truncateText(textContent, 1000),
      lineNumber,
      testName,
      stackTrace,
      source: "html",
    };
  }

  /**
   * Extract error message from text
   */
  private static extractErrorMessage(text: string): string {
    // Look for common error patterns
    const errorPatterns = [
      /TimeoutError:\s*([^\n]+)/i,
      /Error:\s*([^\n]+)/i,
      /Failed:\s*([^\n]+)/i,
      /Exception:\s*([^\n]+)/i,
      /AssertionError:\s*([^\n]+)/i,
    ];

    for (const pattern of errorPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    // Fallback to first non-empty line
    const lines = text.split("\n").filter((line) => line.trim());
    return lines[0]?.trim() || "Unknown error";
  }

  /**
   * Extract stack trace from error text
   */
  private static extractStackTrace(text: string): string | undefined {
    const lines = text.split("\n");
    const stackLines = lines.filter(
      (line) =>
        line.trim().startsWith("at ") ||
        line.includes(".js:") ||
        line.includes(".ts:") ||
        line.includes("spec.js:")
    );

    return stackLines.length > 0 ? stackLines.join("\n") : undefined;
  }

  /**
   * Truncate text to specified length
   */
  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength) + "...[truncated]";
  }

  /**
   * Extract context around a specific line for better error details
   */
  private static extractContextAroundLine(
    lines: string[],
    lineIndex: number,
    contextLines: number = 3
  ): string {
    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(lines.length, lineIndex + contextLines + 1);

    return lines.slice(start, end).join("\n");
  }

  /**
   * Extract fallback error message when no specific patterns match
   */
  private static extractFallbackErrorMessage(bodyText: string): string {
    // Try to find the most meaningful line from the body text
    const lines = bodyText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Look for lines that contain common failure indicators
    const meaningfulLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes("test") ||
        lower.includes("fail") ||
        lower.includes("error") ||
        lower.includes("timeout") ||
        lower.includes("expect") ||
        lower.includes("assertion") ||
        line.includes("✗") ||
        line.includes("×")
      );
    });

    if (meaningfulLines.length > 0) {
      // Return the first meaningful line, but limit its length
      const message = meaningfulLines[0];
      return message.length > 100 ? message.substring(0, 100) + "..." : message;
    }

    // If no meaningful lines found, return a generic failure message
    return "Test failed - check test execution logs for details";
  }

  /**
   * Extract error information from JavaScript content in HTML reports
   */
  private static extractErrorFromScript(scriptContent: string): string | null {
    // Look for common patterns in Playwright report JavaScript
    const errorPatterns = [
      /"error":\s*"([^"]+)"/i,
      /"message":\s*"([^"]+)"/i,
      /"title":\s*"([^"]*(?:error|fail|timeout)[^"]*)"/i,
      /error:\s*["']([^"']+)["']/i,
      /message:\s*["']([^"']+)["']/i,
      /failed:\s*["']([^"']+)["']/i,
      /timeout:\s*["']([^"']+)["']/i,
    ];

    for (const pattern of errorPatterns) {
      const match = scriptContent.match(pattern);
      if (match && match[1] && match[1].length > 5) {
        return match[1];
      }
    }

    // Look for error-like strings in the script
    const lines = scriptContent.split("\n");
    for (const line of lines) {
      if (
        line.includes("error") ||
        line.includes("failed") ||
        line.includes("timeout")
      ) {
        const cleaned = line.replace(/[{}",]/g, " ").trim();
        if (cleaned.length > 10 && cleaned.length < 200) {
          return cleaned;
        }
      }
    }

    return null;
  }

  /**
   * Convert HTML errors to markdown-like format for AI processing
   */
  static convertErrorsToMarkdownFormat(parsedReport: ParsedHTMLReport): string {
    const {
      errors,
      testName,
      duration,
      status,
      browser,
      totalTests,
      failedTests,
    } = parsedReport;

    let markdown = `# Test Report: ${testName}\n\n`;
    markdown += `**Status**: ${status}\n`;
    markdown += `**Duration**: ${duration}\n`;
    if (browser) {
      markdown += `**Browser**: ${browser}\n`;
    }
    markdown += `**Tests**: ${failedTests}/${totalTests} failed\n\n`;

    if (errors.length > 0) {
      markdown += `## Errors Found: ${errors.length}\n\n`;

      errors.forEach((error, index) => {
        markdown += `### Error ${index + 1}\n\n`;
        markdown += `**Message**: ${error.message}\n\n`;

        if (error.lineNumber) {
          markdown += `**Line**: ${error.lineNumber}\n\n`;
        }

        if (error.stackTrace) {
          markdown += `**Stack Trace**:\n\`\`\`\n${error.stackTrace}\n\`\`\`\n\n`;
        }

        markdown += `**Details**:\n\`\`\`\n${error.details}\n\`\`\`\n\n`;
        markdown += `---\n\n`;
      });
    } else {
      markdown += `## No Specific Errors Extracted\n\n`;
      markdown += `Test failed but no specific error details could be extracted from the report.\n`;
      markdown += `This may be due to:\n`;
      markdown += `- Environment/infrastructure issues\n`;
      markdown += `- Setup/teardown failures\n`;
      markdown += `- Network connectivity problems\n`;
      markdown += `- Configuration issues\n\n`;
    }

    return markdown;
  }
}
