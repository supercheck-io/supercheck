import { NextRequest, NextResponse } from "next/server";
import { AIStreamingService } from "@/lib/ai/ai-streaming-service";
import { AuthService } from "@/lib/ai/ai-security";
import { AIPromptBuilder } from "@/lib/ai/ai-prompts";
import { getActiveOrganization } from "@/lib/session";
import { usageTracker } from "@/lib/services/usage-tracker";
import { headers } from "next/headers";
import { logAuditEvent } from "@/lib/audit-logger";
import { db } from "@/utils/db";
import { runs, jobs, reports } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";


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

interface AnalyzeJobRequest {
  runId: string;
}

// Validate request body
function validateRequest(body: Record<string, unknown>): AnalyzeJobRequest {
  if (!body.runId || typeof body.runId !== "string") {
    throw new Error("Invalid runId parameter");
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(body.runId)) {
    throw new Error("Invalid runId format");
  }

  return { runId: body.runId };
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
    console.error("[AI Analyze Job] Error fetching S3 file %s:", key, error);
    return null;
  }
}

// Fetch HTML report content from S3
async function getTestReportContent(reportS3Url: string): Promise<string | null> {
  try {
    if (!reportS3Url) return null;
    
    // Parse S3 URL: s3://bucket/key or bucket/key format
    let bucket: string;
    let key: string;
    
    if (reportS3Url.startsWith("s3://")) {
      const urlParts = reportS3Url.replace("s3://", "").split("/");
      bucket = urlParts[0];
      key = urlParts.slice(1).join("/");
    } else {
      // Assume it's in format bucket/key or just a key
      const testBucketName = process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
      bucket = testBucketName;
      key = reportS3Url;
    }
    
    return await getS3FileContent(bucket, key);
  } catch (error) {
    console.error("[AI Analyze Job] Error fetching test report:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Step 1: Parse and validate input
    const body = await request.json();
    const { runId } = validateRequest(body);

    // Step 2: Authentication and authorization
    const session = await AuthService.validateUserAccess(request, runId);

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

    // Step 4: Check subscription and AI credits in cloud mode
    const activeOrg = await getActiveOrganization();
    if (activeOrg) {
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

      // Atomically consume AI credit
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

    // Step 5: Fetch run data with report
    const runResult = await db
      .select({
        id: runs.id,
        jobId: runs.jobId,
        status: runs.status,
        durationMs: runs.durationMs,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        logs: runs.logs,
        errorDetails: runs.errorDetails,
        trigger: runs.trigger,
        reportUrl: reports.s3Url,
      })
      .from(runs)
      .leftJoin(
        reports,
        and(
          sql`${reports.entityId} = ${runs.id}::text`,
          eq(reports.entityType, "job")
        )
      )
      .where(eq(runs.id, runId))
      .limit(1);

    const run = runResult[0];

    if (!run) {
      return NextResponse.json(
        { success: false, message: "Run not found" },
        { status: 404 }
      );
    }

    // Step 6: Fetch associated job data
    let jobData = null;
    if (run.jobId) {
      jobData = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, run.jobId))
        .limit(1)
        .then((rows) => rows[0]);
    }

    // Step 7: For Playwright jobs, fetch HTML report if available
    let testReportHtml: string | null = null;
    const isPlaywright = jobData?.jobType === "playwright";
    const isK6 = jobData?.jobType === "k6";
    
    if (isPlaywright && run.reportUrl) {
      testReportHtml = await getTestReportContent(run.reportUrl);
    }

    // Step 8: Build AI prompt

    const prompt = AIPromptBuilder.buildJobAnalyzePrompt({
      run: {
        id: run.id,
        status: run.status,
        durationMs: run.durationMs,
        startedAt: run.startedAt?.toISOString() || null,
        completedAt: run.completedAt?.toISOString() || null,
        errorDetails: run.errorDetails || null,
        logs: run.logs || null,
        testCount: null, // Not included in our select
      },
      job: jobData ? {
        id: jobData.id,
        name: jobData.name,
        type: jobData.jobType,
        scriptContent: undefined, // Script content not available on jobs table
      } : null,
      testReportHtml: testReportHtml || undefined,
    });


    // Step 9: Generate streaming AI response
    const aiResponse = await AIStreamingService.generateStreamingResponse({
      prompt,
      maxTokens: 4000,
      temperature: 0.2,
      testType: isK6 ? "performance" : "browser",
    });

    // Step 10: Log audit event
    try {
      if (activeOrg) {
        await logAuditEvent({
          userId: session.user.id,
          organizationId: activeOrg.id,
          action: "ai_analyze",
          resource: "job_run",
          resourceId: runId,
          success: true,
          ipAddress: clientIp,
          metadata: {
            jobName: jobData?.name || "Unknown",
            jobType: jobData?.jobType || "unknown",
            model: aiResponse.model,
          },
        });
      }
    } catch (trackingError) {
      console.error("[AI Analyze Job] Failed to log audit event:", trackingError);
    }

    // Step 11: Return streaming response
    return new NextResponse(aiResponse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-AI-Model": aiResponse.model,
        "X-Operation": "analyze-job",
      },
    });
  } catch (error) {
    console.error("[AI Analyze Job] Streaming failed:", error);

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
          "Failed to generate AI analysis. Please try again or check the run manually.",
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
      service: "ai-analyze-job-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-analyze-job-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
