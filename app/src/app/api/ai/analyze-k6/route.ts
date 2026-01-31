import { NextRequest, NextResponse } from "next/server";
import { AIStreamingService } from "@/lib/ai/ai-streaming-service";
import { AuthService } from "@/lib/ai/ai-security";
import { AIPromptBuilder } from "@/lib/ai/ai-prompts";
import { getActiveOrganization } from "@/lib/session";
import { usageTracker } from "@/lib/services/usage-tracker";
import { headers } from "next/headers";
import { logAuditEvent } from "@/lib/audit-logger";
import { getS3FileContent } from "@/lib/s3-proxy";

// Interface for K6 run metrics
interface K6RunMetrics {
  p95ResponseTimeMs?: number | null;
  p99ResponseTimeMs?: number | null;
  avgResponseTimeMs?: number | null;
  totalRequests?: number | null;
  failedRequests?: number | null;
  vusMax?: number | null;
}

interface K6RunData {
  runId: string;
  status?: string;
  startedAt?: string;
  durationMs?: number | null;
  requestRate?: number | null;
  metrics: K6RunMetrics;
  reportS3Url?: string | null;
  jobName?: string;
}

interface AnalyzeK6Request {
  baselineRun: K6RunData;
  compareRun: K6RunData;
}

// Validate request body
function validateRequest(body: Record<string, unknown>): AnalyzeK6Request {
  if (!body.baselineRun || typeof body.baselineRun !== "object") {
    throw new Error("Invalid baselineRun parameter");
  }
  if (!body.compareRun || typeof body.compareRun !== "object") {
    throw new Error("Invalid compareRun parameter");
  }

  const baselineRun = body.baselineRun as K6RunData;
  const compareRun = body.compareRun as K6RunData;

  if (!baselineRun.runId || typeof baselineRun.runId !== "string") {
    throw new Error("Invalid baselineRun.runId parameter");
  }
  if (!baselineRun.metrics || typeof baselineRun.metrics !== "object") {
    throw new Error("Invalid baselineRun.metrics parameter");
  }
  if (!compareRun.runId || typeof compareRun.runId !== "string") {
    throw new Error("Invalid compareRun.runId parameter");
  }
  if (!compareRun.metrics || typeof compareRun.metrics !== "object") {
    throw new Error("Invalid compareRun.metrics parameter");
  }

  // Optional string validation
  if (baselineRun.jobName && typeof baselineRun.jobName !== "string") {
    delete baselineRun.jobName;
  }

  return { baselineRun, compareRun };
}

// Fetch k6 HTML report content
async function getK6ReportContent(runId: string): Promise<string | null> {
  try {
    const testBucketName =
      process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
    const reportPath = `${runId}/report/index.html`;
    return await getS3FileContent(testBucketName, reportPath);
  } catch (error) {
    console.error("[AI Analyze k6] Error fetching report for run %s:", runId, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Step 1: Parse and validate input
    const body = await request.json();
    const { baselineRun, compareRun } = validateRequest(body);

    // Step 2: Authentication and authorization
    // Validate access to BOTH runs to prevent horizontal privilege escalation
    const [session] = await Promise.all([
      AuthService.validateUserAccess(request, baselineRun.runId),
      AuthService.validateUserAccess(request, compareRun.runId),
    ]);

    // Step 3: Rate limiting check
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
            guidance: "Please subscribe to a plan at /billing to use AI Analyze",
          },
          { status: 402 }
        );
      }

      // Atomically consume AI credit (prevents race conditions)
      // This increments first, then checks limit, and rolls back if exceeded
      const creditResult = await usageTracker.consumeAICredit(activeOrg.id, "ai_analyze");
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

    // Step 4: Fetch K6 HTML reports for both runs (optional, for enhanced analysis)
    const [baselineReport, compareReport] = await Promise.all([
      getK6ReportContent(baselineRun.runId),
      getK6ReportContent(compareRun.runId),
    ]);

    // Step 5: Build AI prompt for K6 comparison analysis
    const prompt = AIPromptBuilder.buildK6AnalyzePrompt({
      baselineRun,
      compareRun,
      baselineReportHtml: baselineReport || undefined,
      compareReportHtml: compareReport || undefined,
    });

    // Step 6: Generate streaming AI response
    const aiResponse = await AIStreamingService.generateStreamingResponse({
      prompt,
      maxTokens: 4000,
      temperature: 0.2,
      testType: "performance",
    });

    // Step 7: Log audit event (credit already consumed atomically above)
    try {
      if (activeOrg) {
        await logAuditEvent({
          userId: session.user.id,
          organizationId: activeOrg.id,
          action: "ai_analyze",
          resource: "k6_run_comparison",
          resourceId: `${baselineRun.runId}:${compareRun.runId}`,
          success: true,
          ipAddress: clientIp,
          metadata: {
            baselineRunId: baselineRun.runId,
            compareRunId: compareRun.runId,
            model: aiResponse.model,
          },
        });
      }
    } catch (trackingError) {
      console.error("[AI Analyze K6] Failed to log audit event:", trackingError);
    }


    // Step 8: Return streaming response with appropriate headers
    return new NextResponse(aiResponse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-AI-Model": aiResponse.model,
        "X-Operation": "analyze-k6",
      },
    });
  } catch (error) {
    console.error("[AI Analyze k6] Streaming failed:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isAuthError =
      errorMessage.includes("Authentication") ||
      errorMessage.includes("Unauthorized");
    const isRateLimitError =
      errorMessage.includes("rate limit") ||
      errorMessage.includes("too many requests");

    if (isAuthError) {
      return NextResponse.json(
        {
          success: false,
          reason: "authentication_required",
          message: "Authentication required to use AI analyze feature",
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
          message:
            "Too many AI analyze requests. Please wait before trying again.",
          guidance:
            "Rate limiting helps ensure fair usage and service availability",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        reason: "generation_failed",
        message:
          "Failed to generate AI analysis. Please try again or check the comparison manually.",
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    const healthStatus = await AIStreamingService.healthCheck();

    return NextResponse.json({
      status: healthStatus.status,
      timestamp: new Date().toISOString(),
      service: "ai-analyze-k6-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-analyze-k6-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
