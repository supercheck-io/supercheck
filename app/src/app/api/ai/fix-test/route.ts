import { NextRequest, NextResponse } from "next/server";
import { AIFixService } from "@/lib/ai-service";
import { AISecurityService, AuthService } from "@/lib/ai-security";
import {
  PlaywrightMarkdownParser,
  AIFixDecisionEngine,
  FailureCategory,
} from "@/lib/ai-classifier";
import { AIPromptBuilder } from "@/lib/ai-prompts";
import { HTMLReportParser } from "@/lib/html-report-parser";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

// Rate limiting store (in production, use Redis)
// const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

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
    await AuthService.validateUserAccess(request, testId);
    await AuthService.checkRateLimit();

    // Step 3: Try to get markdown report URL first
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
      // Step 4a: Securely fetch markdown content with validation
      errorContext = await AISecurityService.securelyFetchMarkdownReport(
        markdownReportUrl
      );

      // Step 5a: Parse markdown for error classification
      errorClassifications =
        PlaywrightMarkdownParser.parseMarkdownForErrors(errorContext);
    } else {
      // Step 4b: Fallback to HTML report parsing
      const htmlContent = await getHTMLReportContent(testId);
      if (!htmlContent) {
        return NextResponse.json(
          {
            success: false,
            reason: "report_not_available",
            message:
              "No test report (markdown or HTML) found. Please ensure the test has failed and reports are generated.",
            guidance: AIPromptBuilder.generateGuidanceMessage(),
          },
          { status: 400 }
        );
      }

      // Step 5b: Parse HTML report for error information
      const parsedHtmlReport = await HTMLReportParser.parseHTMLReport(
        htmlContent
      );

      errorContext =
        HTMLReportParser.convertErrorsToMarkdownFormat(parsedHtmlReport);
      contextSource = "html";

      // Convert HTML errors to the same format as markdown errors for consistency
      errorClassifications = parsedHtmlReport.errors.map((error) => ({
        message: error.message,
        location: error.lineNumber
          ? `line ${error.lineNumber}`
          : "unknown location",
        stackTrace: error.stackTrace,
        classification: {
          category: categorizeHTMLError(error.message),
          confidence: 0.8,
          aiFixable: true, // Assume HTML errors are fixable
          keywords: [error.testName],
          patterns: [],
          severity: "medium" as const,
        },
      }));
    }

    // Step 5: Make fix decision based on error classifications
    const fixDecision =
      AIFixDecisionEngine.shouldAttemptMarkdownFix(errorClassifications);

    // Improve confidence calculation for HTML parsing
    if (contextSource === "html" && fixDecision.shouldAttemptFix) {
      const errorQuality = calculateHTMLErrorConfidence(errorClassifications);
      fixDecision.confidence = Math.max(fixDecision.confidence, errorQuality);
    }

    // Step 6: Return early if environmental issues detected
    if (!fixDecision.shouldAttemptFix) {
      // If we have no errors found but the user is still requesting a fix,
      // let's try a basic AI analysis with the test script itself
      if (errorClassifications.length === 0 && failedScript) {
        try {
          const basicPrompt = AIPromptBuilder.buildBasicFixPrompt({
            failedScript,
            testType,
            reason: "No detailed error report available",
          });

          const aiResponse = await AIFixService.generateScriptFix({
            prompt: basicPrompt,
            temperature: 0.2,
            testType: testType as "browser" | "api" | "custom" | "database",
          });

          const sanitizedScript = AISecurityService.sanitizeCodeOutput(
            aiResponse.fixedScript
          );
          const sanitizedExplanation = AISecurityService.sanitizeTextOutput(
            aiResponse.explanation
          );

          // Use AI confidence if available, otherwise use default for basic analysis
          const basicConfidence = aiResponse.aiConfidence || 0.7;

          return NextResponse.json({
            success: true,
            fixedScript: sanitizedScript,
            explanation: sanitizedExplanation,
            confidence: basicConfidence,
            contextSource: "basic_analysis",
            aiMetrics: {
              model: aiResponse.model,
              duration: aiResponse.duration,
              tokensUsed: aiResponse.usage.totalTokens,
              promptTokens: aiResponse.usage.promptTokens,
              completionTokens: aiResponse.usage.completionTokens,
            },
            errorAnalysis: {
              totalErrors: 0,
              fixableErrors: 0,
              topIssues: ["basic_analysis"],
            },
          });
        } catch {
          // Basic analysis failed - this is not an error condition, just means we couldn't analyze
        }
      }

      return NextResponse.json({
        success: false,
        reason: "not_fixable",
        decision: fixDecision,
        guidance: AIPromptBuilder.generateGuidanceMessage(),
        errorAnalysis: {
          totalErrors: errorClassifications.length,
          categories: errorClassifications
            .map((ec) => ec.classification?.category)
            .filter(Boolean),
        },
      });
    }

    // Step 7: Build secure markdown-optimized AI prompt
    const prompt = AIPromptBuilder.buildMarkdownContextPrompt({
      failedScript,
      testType,
      markdownContent: errorContext,
    });

    // Step 8: Call AI service with intelligent prompt using Vercel AI SDK
    const aiResponse = await AIFixService.generateScriptFix({
      prompt,
      maxTokens: 2000,
      temperature: 0.1, // Low temperature for consistent, reliable fixes
      testType: testType as "browser" | "api" | "custom" | "database",
    });

    // Step 9: Validate and sanitize AI output
    const sanitizedScript = AISecurityService.sanitizeCodeOutput(
      aiResponse.fixedScript
    );
    const sanitizedExplanation = AISecurityService.sanitizeTextOutput(
      aiResponse.explanation
    );

    // Use AI confidence if available, otherwise use fix decision confidence
    const finalConfidence = aiResponse.aiConfidence || fixDecision.confidence;

    return NextResponse.json({
      success: true,
      fixedScript: sanitizedScript,
      explanation: sanitizedExplanation,
      confidence: finalConfidence,
      contextSource,
      aiMetrics: {
        model: aiResponse.model,
        duration: aiResponse.duration,
        tokensUsed: aiResponse.usage.totalTokens,
        promptTokens: aiResponse.usage.promptTokens,
        completionTokens: aiResponse.usage.completionTokens,
      },
      errorAnalysis: {
        totalErrors: errorClassifications.length,
        fixableErrors: errorClassifications.filter(
          (ec) => ec.classification?.aiFixable
        ).length,
        topIssues: errorClassifications
          .map((ec) => ec.classification?.category)
          .filter(Boolean)
          .slice(0, 3),
      },
    });
  } catch (error) {
    console.error("AI fix generation failed:", error);

    // Determine error type for appropriate response
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

    // Generic error response
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

// Helper function to get markdown report URL using AWS SDK
async function getMarkdownReportUrl(testId: string): Promise<string | null> {
  try {
    const s3Endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";

    // Look specifically in the data folder where Playwright stores .md files
    const dataFolderPrefix = `${testId}/report/data/`;

    try {
      const command = new ListObjectsV2Command({
        Bucket: testBucketName,
        Prefix: dataFolderPrefix,
      });

      const response = await s3Client.send(command);

      if (response.Contents && response.Contents.length > 0) {
        // Look for .md files
        const mdFiles = response.Contents.map((obj) => obj.Key).filter(
          (key) => key && key.endsWith(".md")
        );

        if (mdFiles.length > 0) {
          const foundKey = mdFiles[0]; // Use the first .md file found
          const foundUrl = `${s3Endpoint}/${testBucketName}/${foundKey}`;
          return foundUrl;
        }
      }
    } catch (awsError) {
      // AWS SDK error - log at error level
      console.error("Error listing markdown files in S3:", awsError);
    }

    return null;
  } catch (error) {
    console.error("Error getting markdown report URL:", error);
    return null;
  }
}

// Helper function to get HTML report content for fallback parsing
async function getHTMLReportContent(testId: string): Promise<string | null> {
  try {
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
    const htmlPath = `${testId}/report/index.html`;

    const command = new GetObjectCommand({
      Bucket: testBucketName,
      Key: htmlPath,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return null;
    }

    // Convert stream to string
    const chunks: Uint8Array[] = [];
    const awsStream = response.Body as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };

    if (awsStream.transformToByteArray) {
      const bytes = await awsStream.transformToByteArray();
      return new TextDecoder().decode(bytes);
    }

    // Fallback for other stream types
    const stream = response.Body as ReadableStream;
    if (stream && typeof stream.getReader === "function") {
      const reader = stream.getReader();

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
    console.error("[AI Fix Debug] Error fetching HTML report:", error);
    return null;
  }
}

// Helper function to calculate confidence based on HTML error quality
function calculateHTMLErrorConfidence(
  errorClassifications: Array<{
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
  }>
): number {
  if (errorClassifications.length === 0) return 0.3;

  let confidenceScore = 0.6; // Base confidence for HTML parsing

  // Increase confidence based on error quality
  for (const error of errorClassifications) {
    // Detailed error messages increase confidence
    if (error.message.length > 50) {
      confidenceScore += 0.1;
    }

    // Stack traces significantly increase confidence
    if (error.stackTrace && error.stackTrace.length > 20) {
      confidenceScore += 0.15;
    }

    // Specific location information increases confidence
    if (error.location && error.location !== "unknown location") {
      confidenceScore += 0.05;
    }

    // Well-known error types increase confidence
    if (
      error.message.toLowerCase().includes("timeout") ||
      error.message.toLowerCase().includes("assertion") ||
      error.message.toLowerCase().includes("expect")
    ) {
      confidenceScore += 0.1;
    }
  }

  // Cap confidence at 0.85 for HTML-based analysis
  return Math.min(confidenceScore, 0.85);
}

// Helper function to categorize HTML errors for AI processing
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
  if (
    message.includes("database") ||
    message.includes("db") ||
    message.includes("sql")
  ) {
    return FailureCategory.DATA_ISSUES;
  }
  if (
    message.includes("server") ||
    message.includes("api") ||
    message.includes("service")
  ) {
    return FailureCategory.INFRASTRUCTURE_DOWN;
  }
  if (
    message.includes("navigate") ||
    message.includes("page") ||
    message.includes("route")
  ) {
    return FailureCategory.NAVIGATION_ERRORS;
  }

  return FailureCategory.UNKNOWN;
}

// Health check endpoint
export async function GET() {
  try {
    const healthStatus = await AIFixService.healthCheck();

    return NextResponse.json({
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      service: "ai-fix-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-fix-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
