import {
  HTMLReportParser,
  type ParsedHTMLReport,
} from "./html-report-parser";

/**
 * `parseHTMLReport` lazily imports the `jsdom` package, whose dependency tree
 * includes ESM-only `parse5` that Jest cannot load with the current config.
 * The test environment already provides a real DOM implementation, so the
 * parser is exercised against the environment's DOMParser instead. This keeps
 * every selector/extraction path real; only `new JSDOM(html)` itself is faked.
 */
jest.mock("jsdom", () => ({
  JSDOM: class {
    window: { document: Document };
    constructor(html: string) {
      this.window = { document: new DOMParser().parseFromString(html, "text/html") };
    }
  },
}));

describe("HTMLReportParser", () => {
  describe("parseHTMLReport", () => {
    it("extracts the test name, duration, and errors from a failure report", async () => {
      const html = `
        <html>
          <head><title>Login Suite</title></head>
          <body>
            <h1>Login Test</h1>
            <div class="test-duration">2.5s</div>
            <div class="error">Error: expect(received).toBe(expected) at login.spec.ts:42:5</div>
          </body>
        </html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.testName).toBe("Login Test");
      expect(report.duration).toBe("2.5s");
      expect(report.status).toBe("failed");
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].message).toContain("Error: expect(received)");
      expect(report.errors[0].source).toBe("html");
      expect(report.errors[0].testName).toBe("Login Test");
    });

    it("extracts a line number and stack trace from an error element", async () => {
      const html = `
        <html><body>
          <h1>Checkout</h1>
          <pre>TimeoutError: waiting for selector '#submit'
    at checkout.spec.ts:88:12</pre>
        </body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);
      const error = report.errors[0];

      expect(error.message).toContain("TimeoutError");
      expect(error.lineNumber).toBe(88);
      expect(error.stackTrace).toContain("checkout.spec.ts:88:12");
    });

    it("falls back to the <title> when no heading exists", async () => {
      const html = `<html><head><title>Fallback Title</title></head><body><p>ok</p></body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.testName).toBe("Fallback Title");
    });

    it("returns Unknown Test when no name can be found", async () => {
      const html = `<html><body><p>plain body</p></body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.testName).toBe("Unknown Test");
    });

    it("extracts duration from body text when no duration element exists", async () => {
      const html = `<html><body><h1>Slow Test</h1><p>Finished in 12.5s</p></body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.duration).toBe("12.5s");
    });

    it.each([
      ["passed", "<p>All tests passed</p>"],
      ["failed", "<p>Test failed with Error: boom</p>"],
      ["skipped", "<p>1 skipped</p>"],
      ["flaky", "<p>1 flaky</p>"],
    ] as const)("detects %s status", async (status, body) => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Status</h1>${body}</body></html>`,
      );

      expect(report.status).toBe(status);
    });

    it("defaults to failed when status cannot be determined", async () => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Status</h1><p>nothing useful here</p></body></html>`,
      );

      expect(report.status).toBe("failed");
    });

    it("extracts browser information", async () => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Browser</h1><p>Running on chromium 120</p></body></html>`,
      );

      expect(report.browser).toBe("chromium");
    });

    it("extracts test counts from summary text", async () => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Summary</h1><p>All 5 tests</p><p>Failed 2 tests</p></body></html>`,
      );

      expect(report.totalTests).toBe(5);
      expect(report.failedTests).toBe(2);
    });

    it("defaults counts to a single failing test", async () => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Summary</h1><p>Error: boom</p></body></html>`,
      );

      expect(report.totalTests).toBe(1);
      expect(report.failedTests).toBe(1);
    });

    it("extracts error lines from body text when no error element exists", async () => {
      const html = `<html><body><h1>Checkout</h1>Test failed: TimeoutError: waiting for selector '#submit'</body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].message).toContain("TimeoutError");
    });

    it("extracts error details from embedded Playwright report data", async () => {
      const filler = "x".repeat(120);
      const html = `
        <html><body>
          <p>Playwright report</p>
          <script>var reportData = { "error": "Timeout waiting for navigation", "details": "${filler}" };</script>
        </body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].message).toBe("Timeout waiting for navigation");
      expect(report.errors[0].testName).toContain("(from script)");
    });

    it("produces a generic error for failed reports with no extractable details", async () => {
      const html = `
        <html><body>
          <h1>Weird Report</h1>
          <p>Something went wrong with an error during setup</p>
        </body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.errors.length).toBe(1);
      expect(report.errors[0].message).toContain("Test failed");
    });

    it("ignores short error elements", async () => {
      const report = await HTMLReportParser.parseHTMLReport(
        `<html><body><h1>Short</h1><div class="failure">short</div></body></html>`,
      );

      expect(report.errors).toEqual([]);
    });

    it("truncates very long error details", async () => {
      const html = `<html><body><h1>Long</h1><div class="error">Error: boom ${"x".repeat(2000)}</div></body></html>`;

      const report = await HTMLReportParser.parseHTMLReport(html);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].details).toContain("...[truncated]");
      expect(report.errors[0].details.length).toBeLessThan(1100);
    });

    it("returns defaults for empty input without throwing", async () => {
      const report = await HTMLReportParser.parseHTMLReport("");

      expect(report.testName).toBe("Unknown Test");
      expect(report.errors).toEqual([]);
    });
  });

  describe("convertErrorsToMarkdownFormat", () => {
    const baseReport: ParsedHTMLReport = {
      errors: [],
      testName: "Login Test",
      duration: "2.5s",
      status: "failed",
      browser: "chromium",
      totalTests: 3,
      failedTests: 1,
    };

    it("renders the report header", () => {
      const markdown = HTMLReportParser.convertErrorsToMarkdownFormat(baseReport);

      expect(markdown).toContain("# Test Report: Login Test");
      expect(markdown).toContain("**Status**: failed");
      expect(markdown).toContain("**Duration**: 2.5s");
      expect(markdown).toContain("**Browser**: chromium");
      expect(markdown).toContain("**Tests**: 1/3 failed");
    });

    it("renders each extracted error", () => {
      const markdown = HTMLReportParser.convertErrorsToMarkdownFormat({
        ...baseReport,
        errors: [
          {
            message: "Error: boom",
            details: "stack details",
            lineNumber: 42,
            testName: "Login Test",
            stackTrace: "at login.spec.ts:42:5",
            source: "html",
          },
        ],
      });

      expect(markdown).toContain("## Errors Found: 1");
      expect(markdown).toContain("**Message**: Error: boom");
      expect(markdown).toContain("**Line**: 42");
      expect(markdown).toContain("**Stack Trace**:");
      expect(markdown).toContain("stack details");
    });

    it("explains when no errors were extracted", () => {
      const markdown = HTMLReportParser.convertErrorsToMarkdownFormat(baseReport);

      expect(markdown).toContain("## No Specific Errors Extracted");
      expect(markdown).toContain("Test failed but no specific error details");
    });
  });
});
