import { NextRequest, NextResponse } from "next/server";
import { AIStreamingService } from "@/lib/ai/ai-streaming-service";
import { AISecurityService, AuthService } from "@/lib/ai/ai-security";
import {
  PlaywrightMarkdownParser,
  AIFixDecisionEngine,
  FailureCategory,
} from "@/lib/ai/ai-classifier";
import { K6LogParser, K6FixDecisionEngine } from "@/lib/k6-classifier";
import { AIPromptBuilder } from "@/lib/ai/ai-prompts";
import { HTMLReportParser } from "@/lib/html-report-parser";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getActiveOrganization } from "@/lib/session";
import { usageTracker } from "@/lib/services/usage-tracker";
import { headers } from "next/headers";
import { logAuditEvent } from "@/lib/audit-logger";

// Minimum stack trace length to consider as useful for error analysis
const MINIMUM_USEFUL_STACKTRACE_LENGTH = 50;

// S3 Client configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: true, // Required for MinIO
});

export async function POST(request: NextRequest) {
  try {
    // Step 1: Input validation and sanitization
    const body = await request.json();
    const validatedInput = AISecurityService.validateInputs(body);
    const { failedScript, testType, testId } = validatedInput;

    // Step 2: Authentication and authorization
    const session = await AuthService.validateUserAccess(request, testId);

    // Step 3: Rate limiting check (with user/org context)
    const headersList = await headers();
    const clientIp =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip") ||
      "unknown";

    await AuthService.checkRateLimit({
      userId: session.user.id,
      orgId: session.user.organizationId,
      ip: clientIp,
      tier: session.tier,
    });

    // Step 3.5: CRITICAL - Check subscription and AI credits in cloud mode
    const activeOrg = await getActiveOrganization();
    if (activeOrg) {
      // Import subscription service
      const { subscriptionService } = await import("@/lib/services/subscription-service");
      
      try {
        await subscriptionService.blockUntilSubscribed(activeOrg.id);
        await subscriptionService.requireValidPolarCustomer(activeOrg.id);
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            reason: "subscription_required",
            message:
              error instanceof Error
                ? error.message
                : "Subscription required to use AI features",
            guidance: "Please subscribe to a plan at /billing to use AI Fix",
          },
          { status: 402 }
        );
      }

      // Atomically consume AI credit (prevents race conditions)
      // This increments first, then checks limit, and rolls back if exceeded
      const creditResult = await usageTracker.consumeAICredit(activeOrg.id, "ai_fix");
      if (!creditResult.allowed) {
        return NextResponse.json(
          {
            success: false,
            reason: "ai_credits_exhausted",
            message: creditResult.reason,
            guidance: "Upgrade your plan for more AI credits or wait until your next billing cycle.",
            usage: {
              used: creditResult.used,
              limit: creditResult.limit,
            },
          },
          { status: 429 }
        );
      }
    }

    let prompt: string;
    let confidence = 0.7;

    // Step 3: Handle different test types
    if (testType === "performance") {
      // K6 Performance test
      const { consoleLog, summaryJSON } = await getK6TestResults(testId);

      // Parse K6 errors
      const consoleErrors = K6LogParser.parseConsoleLog(consoleLog || "");
      const summaryErrors = K6LogParser.parseSummaryJSON(summaryJSON || "");
      const allErrors = [...consoleErrors, ...summaryErrors];

      // ALWAYS attempt fix - no threshold checks
      // Get error analysis for metrics but don't gate on it
      const fixDecision = K6FixDecisionEngine.shouldAttemptFix(allErrors);
      confidence = fixDecision.confidence;

      // Build K6 fix prompt - always attempt to fix
      prompt = AIPromptBuilder.buildK6FixPrompt({
        failedScript,
        consoleLog: consoleLog || "",
        summaryJSON: summaryJSON || "",
      });
    } else {
      // Playwright test (browser, api, database, custom)
      const markdownReportUrl = await getMarkdownReportUrl(testId);

      let errorContext: string;
      let errorClassifications: Array<{
        message: string;
        location: string;
        stackTrace?: string;
        classification?: {
          category: FailureCategory;
          confidence: number;
          aiFixable: boolean;
          keywords: string[];
          patterns: RegExp[];
          severity: "low" | "medium" | "high" | "critical";
        };
      }>;
      let contextSource: "markdown" | "html" = "markdown";

      if (markdownReportUrl) {
        errorContext =
          await AISecurityService.securelyFetchMarkdownReport(
            markdownReportUrl
          );
        errorClassifications =
          PlaywrightMarkdownParser.parseMarkdownForErrors(errorContext);
      } else {
        // Try multiple sources for error information
        const htmlContent = await getHTMLReportContent(testId);
        const resultsJSON = await getPlaywrightResultsJSON(testId);

        if (!htmlContent && !resultsJSON.found) {
          return NextResponse.json(
            {
              success: false,
              reason: "report_not_available",
              message:
                "No test report found. Please ensure the test has failed and reports are generated.",
              guidance: AIPromptBuilder.generateGuidanceMessage(),
            },
            { status: 400 }
          );
        }

        // Parse HTML if available
        let parsedHtmlReport = null;
        if (htmlContent) {
          parsedHtmlReport = await HTMLReportParser.parseHTMLReport(htmlContent);
        }

        // Combine error sources for better coverage (especially for browser tests)
        const htmlErrors = parsedHtmlReport?.errors || [];
        const jsonErrors = resultsJSON.errors;

        // Use results.json errors as primary source if they have more specific information
        // This is crucial for browser tests where HTML might only have JavaScript-rendered content
        if (jsonErrors.length > 0 && (htmlErrors.length === 0 || 
            jsonErrors.some(e => e.stackTrace && e.stackTrace.length > MINIMUM_USEFUL_STACKTRACE_LENGTH))) {
          // Prefer results.json as it has structured error data
          errorContext = convertResultsJSONToMarkdown(jsonErrors);
          if (parsedHtmlReport) {
            // Append HTML context for additional information
            const htmlContext = HTMLReportParser.convertErrorsToMarkdownFormat(parsedHtmlReport);
            errorContext += "\n\n## Additional Context from HTML Report\n\n" + htmlContext;
          }
          contextSource = "html"; // Still mark as html for confidence calculation

          errorClassifications = jsonErrors.map((error) => ({
            message: error.message,
            location: "from results.json",
            stackTrace: error.stackTrace,
            classification: {
              category: categorizeHTMLError(error.message),
              confidence: 0.85, // Higher confidence for structured JSON data
              aiFixable: true,
              keywords: [error.testName],
              patterns: [],
              severity: "medium" as const,
            },
          }));
        } else if (parsedHtmlReport) {
          // Fallback to HTML parsing
          errorContext = HTMLReportParser.convertErrorsToMarkdownFormat(parsedHtmlReport);
          contextSource = "html";

          errorClassifications = parsedHtmlReport.errors.map((error) => ({
            message: error.message,
            location: error.lineNumber
              ? `line ${error.lineNumber}`
              : "unknown location",
            stackTrace: error.stackTrace,
            classification: {
              category: categorizeHTMLError(error.message),
              confidence: 0.8,
              aiFixable: true,
              keywords: [error.testName],
              patterns: [],
              severity: "medium" as const,
            },
          }));
        } else {
          // Last resort: we have results.json but no detailed errors
          errorContext = "Test failed but no detailed error information could be extracted.";
          errorClassifications = [];
        }
      }

      // ALWAYS attempt fix - no threshold checks
      // Get error analysis for metrics but don't gate on it
      const fixDecision =
        AIFixDecisionEngine.shouldAttemptMarkdownFix(errorClassifications);

      if (contextSource === "html") {
        const errorQuality = calculateHTMLErrorConfidence(errorClassifications);
        confidence = Math.max(fixDecision.confidence, errorQuality);
      } else {
        confidence = fixDecision.confidence;
      }

      // Build appropriate prompt based on available error context - always attempt to fix
      if (errorClassifications.length === 0 && failedScript) {
        prompt = AIPromptBuilder.buildBasicFixPrompt({
          failedScript,
          testType,
          reason: "No detailed error report available",
        });
      } else {
        prompt = AIPromptBuilder.buildMarkdownContextPrompt({
          failedScript,
          testType,
          markdownContent: errorContext,
        });
      }
    }

    // Step 4: Generate streaming AI response
    const aiResponse = await AIStreamingService.generateStreamingResponse({
      prompt,
      maxTokens: 4000,
      temperature: 0.1,
      testType,
    });

    // Step 5: Log audit event (credit already consumed atomically above)
    try {
      if (activeOrg) {
        await logAuditEvent({
          userId: session.user.id,
          organizationId: activeOrg.id,
          action: "ai_fix",
          resource: "test",
          resourceId: testId,
          success: true,
          ipAddress: clientIp,
          metadata: {
            testId,
            testType,
            confidence,
            model: aiResponse.model,
          },
        });
      }
    } catch (trackingError) {
      console.error("[AI Fix Stream] Failed to log audit event:", trackingError);
    }


    // Step 6: Return streaming response with appropriate headers
    return new NextResponse(aiResponse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-AI-Model": aiResponse.model,
        "X-AI-Confidence": confidence.toString(),
      },
    });
  } catch (error) {
    console.error("AI fix streaming failed:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isAuthError =
      errorMessage.includes("Authentication") ||
      errorMessage.includes("Unauthorized");
    const isRateLimitError =
      errorMessage.includes("rate limit") ||
      errorMessage.includes("too many requests");
    const isSecurityError =
      errorMessage.includes("unsafe") || errorMessage.includes("security");

    if (isAuthError) {
      return NextResponse.json(
        {
          success: false,
          reason: "authentication_required",
          message: "Authentication required to use AI fix feature",
          guidance: "Please log in and try again",
        },
        { status: 401 }
      );
    }

    if (isRateLimitError) {
      return NextResponse.json(
        {
          success: false,
          reason: "rate_limited",
          message: "Too many AI fix requests. Please wait before trying again.",
          guidance:
            "Rate limiting helps ensure fair usage and service availability",
        },
        { status: 429 }
      );
    }

    if (isSecurityError) {
      return NextResponse.json(
        {
          success: false,
          reason: "security_violation",
          message: "Request blocked for security reasons",
          guidance:
            "Please ensure your test script follows security guidelines",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        reason: "generation_failed",
        message: "Failed to generate AI fix. Please try manual investigation.",
        guidance: AIPromptBuilder.generateGuidanceMessage(),
      },
      { status: 500 }
    );
  }
}

// Helper function to get K6 test results
async function getK6TestResults(runId: string): Promise<{
  consoleLog: string | null;
  summaryJSON: string | null;
}> {
  try {
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";

    const consolePath = `${runId}/console.log`;
    const summaryPath = `${runId}/summary.json`;

    const [consoleLog, summaryJSON] = await Promise.all([
      getS3FileContent(testBucketName, consolePath),
      getS3FileContent(testBucketName, summaryPath),
    ]);

    return { consoleLog, summaryJSON };
  } catch (error) {
    console.error("Error getting K6 test results:", error);
    return { consoleLog: null, summaryJSON: null };
  }
}

// Helper function to get S3 file content
async function getS3FileContent(
  bucket: string,
  key: string
): Promise<string | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return null;
    }

    const awsStream = response.Body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };

    if (awsStream.transformToByteArray) {
      const bytes = await awsStream.transformToByteArray();
      return new TextDecoder().decode(bytes);
    }

    const stream = response.Body as ReadableStream;
    if (stream && typeof stream.getReader === "function") {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const totalLength = chunks.reduce(
        (sum, chunk) => sum + chunk.byteLength,
        0
      );
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return new TextDecoder().decode(result);
    }

    return null;
  } catch (error) {
    console.error(`Error fetching S3 file ${key}:`, error);
    return null;
  }
}

// Helper function to get markdown report URL
async function getMarkdownReportUrl(testId: string): Promise<string | null> {
  try {
    const s3Endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";

    const dataFolderPrefix = `${testId}/report/data/`;

    try {
      const command = new ListObjectsV2Command({
        Bucket: testBucketName,
        Prefix: dataFolderPrefix,
      });

      const response = await s3Client.send(command);

      if (response.Contents && response.Contents.length > 0) {
        const mdFiles = response.Contents.map((obj) => obj.Key).filter(
          (key) => key && key.endsWith(".md")
        );

        if (mdFiles.length > 0) {
          const foundKey = mdFiles[0];
          const foundUrl = `${s3Endpoint}/${testBucketName}/${foundKey}`;
          return foundUrl;
        }
      }
    } catch (awsError) {
      console.error("Error listing markdown files in S3:", awsError);
    }

    return null;
  } catch (error) {
    console.error("Error getting markdown report URL:", error);
    return null;
  }
}

// Helper function to get HTML report content
async function getHTMLReportContent(testId: string): Promise<string | null> {
  try {
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
    const htmlPath = `${testId}/report/index.html`;

    return await getS3FileContent(testBucketName, htmlPath);
  } catch (error) {
    console.error("Error fetching HTML report:", error);
    return null;
  }
}

// Helper function to get and parse Playwright results.json for error extraction
async function getPlaywrightResultsJSON(testId: string): Promise<{
  errors: Array<{ message: string; stackTrace?: string; testName: string }>;
  found: boolean;
}> {
  try {
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
    const resultsPath = `${testId}/report/results.json`;

    const content = await getS3FileContent(testBucketName, resultsPath);
    if (!content) {
      return { errors: [], found: false };
    }

    let results: unknown;
    try {
      results = JSON.parse(content);
    } catch (parseError) {
      console.error("Malformed JSON in Playwright results.json:", parseError);
      return { errors: [], found: false };
    }

    const errors: Array<{ message: string; stackTrace?: string; testName: string }> = [];

    // Recursively extract errors from Playwright results.json structure
    const extractErrors = (node: unknown, parentTitle: string = "") => {
      if (!node || typeof node !== "object") return;

      const obj = node as Record<string, unknown>;

      // Handle test results array
      if (Array.isArray(obj.results)) {
        for (const result of obj.results) {
          if (result && typeof result === "object") {
            const r = result as Record<string, unknown>;
            // Check for failed status
            if (r.status === "failed" || r.status === "timedOut") {
              // Extract error from attachments or error field
              if (r.error && typeof r.error === "object") {
                const err = r.error as Record<string, unknown>;
                errors.push({
                  message: String(err.message || "Test failed"),
                  stackTrace: err.stack ? String(err.stack) : undefined,
                  testName: parentTitle || "Unknown test",
                });
              }
              // Also check for errors array
              if (Array.isArray(r.errors)) {
                for (const e of r.errors) {
                  if (e && typeof e === "object") {
                    const err = e as Record<string, unknown>;
                    errors.push({
                      message: String(err.message || "Test error"),
                      stackTrace: err.stack ? String(err.stack) : undefined,
                      testName: parentTitle || "Unknown test",
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Build test title path
      const title = obj.title ? String(obj.title) : "";
      const fullTitle = parentTitle ? `${parentTitle} > ${title}` : title;

      // Recurse into nested structures
      if (Array.isArray(obj.suites)) {
        for (const suite of obj.suites) {
          extractErrors(suite, fullTitle);
        }
      }
      if (Array.isArray(obj.specs)) {
        for (const spec of obj.specs) {
          extractErrors(spec, fullTitle);
        }
      }
      if (Array.isArray(obj.tests)) {
        for (const test of obj.tests) {
          extractErrors(test, fullTitle);
        }
      }
    };

    extractErrors(results);

    return { errors, found: true };
  } catch (error) {
    console.error("Error fetching/parsing results.json:", error);
    return { errors: [], found: false };
  }
}

// Helper function to convert results.json errors to markdown format
function convertResultsJSONToMarkdown(
  errors: Array<{ message: string; stackTrace?: string; testName: string }>
): string {
  if (errors.length === 0) {
    return "";
  }

  let markdown = "# Test Failures from results.json\n\n";
  markdown += `**Total Errors**: ${errors.length}\n\n`;

  errors.forEach((error, index) => {
    markdown += `## Error ${index + 1}: ${error.testName}\n\n`;
    markdown += `**Message**: ${error.message}\n\n`;
    if (error.stackTrace) {
      markdown += `**Stack Trace**:\n\`\`\`\n${error.stackTrace}\n\`\`\`\n\n`;
    }
    markdown += "---\n\n";
  });

  return markdown;
}

// Helper function to calculate confidence based on HTML error quality
function calculateHTMLErrorConfidence(
  errorClassifications: Array<{
    message: string;
    location: string;
    stackTrace?: string;
  }>
): number {
  if (errorClassifications.length === 0) return 0.3;

  let confidenceScore = 0.6;

  for (const error of errorClassifications) {
    if (error.message.length > 50) {
      confidenceScore += 0.1;
    }

    if (error.stackTrace && error.stackTrace.length > 20) {
      confidenceScore += 0.15;
    }

    if (error.location && error.location !== "unknown location") {
      confidenceScore += 0.05;
    }

    if (
      error.message.toLowerCase().includes("timeout") ||
      error.message.toLowerCase().includes("assertion") ||
      error.message.toLowerCase().includes("expect")
    ) {
      confidenceScore += 0.1;
    }
  }

  return Math.min(confidenceScore, 0.85);
}

// Helper function to categorize HTML errors
function categorizeHTMLError(errorMessage: string): FailureCategory {
  const message = errorMessage.toLowerCase();

  if (message.includes("timeout") || message.includes("exceeded")) {
    return FailureCategory.TIMING_PROBLEMS;
  }
  if (
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("fetch")
  ) {
    return FailureCategory.NETWORK_ISSUES;
  }
  if (
    message.includes("auth") ||
    message.includes("login") ||
    message.includes("credential")
  ) {
    return FailureCategory.AUTHENTICATION_FAILURES;
  }
  if (
    message.includes("element") ||
    message.includes("selector") ||
    message.includes("locator")
  ) {
    return FailureCategory.SELECTOR_ISSUES;
  }
  if (
    message.includes("expect") ||
    message.includes("assertion") ||
    message.includes("assert")
  ) {
    return FailureCategory.ASSERTION_FAILURES;
  }

  return FailureCategory.UNKNOWN;
}

// Health check endpoint
export async function GET() {
  try {
    const healthStatus = await AIStreamingService.healthCheck();

    return NextResponse.json({
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      service: "ai-fix-stream-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-fix-stream-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
