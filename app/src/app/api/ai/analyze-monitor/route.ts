import { NextRequest, NextResponse } from "next/server";
import { AIStreamingService } from "@/lib/ai/ai-streaming-service";
import { AuthService } from "@/lib/ai/ai-security";
import { AIPromptBuilder } from "@/lib/ai/ai-prompts";
import { getActiveOrganization } from "@/lib/session";
import { usageTracker } from "@/lib/services/usage-tracker";
import { headers } from "next/headers";
import { logAuditEvent } from "@/lib/audit-logger";
import { db } from "@/utils/db";
import { monitors, monitorResults } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
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

interface AnalyzeMonitorRequest {
  monitorId: string;
}

// Validate request body
function validateRequest(body: Record<string, unknown>): AnalyzeMonitorRequest {
  if (!body.monitorId || typeof body.monitorId !== "string") {
    throw new Error("Invalid monitorId parameter");
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(body.monitorId)) {
    throw new Error("Invalid monitorId format");
  }

  return { monitorId: body.monitorId };
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
    console.error("[AI Analyze Monitor] Error fetching S3 file %s:", key, error);
    return null;
  }
}

// Fetch synthetic test HTML report content
async function getTestReportContent(testReportS3Url: string): Promise<string | null> {
  try {
    if (!testReportS3Url) return null;
    
    // Parse S3 URL: s3://bucket/key or bucket/key format
    let bucket: string;
    let key: string;
    
    if (testReportS3Url.startsWith("s3://")) {
      const urlParts = testReportS3Url.replace("s3://", "").split("/");
      bucket = urlParts[0];
      key = urlParts.slice(1).join("/");
    } else if (testReportS3Url.includes("/")) {
      // Format: bucket/key - split on first "/"
      const firstSlashIndex = testReportS3Url.indexOf("/");
      bucket = testReportS3Url.slice(0, firstSlashIndex);
      key = testReportS3Url.slice(firstSlashIndex + 1);
    } else {
      // Just a key - use default test bucket
      const testBucketName = process.env.S3_TEST_BUCKET_NAME || "playwright-test-artifacts";
      bucket = testBucketName;
      key = testReportS3Url;
    }
    
    return await getS3FileContent(bucket, key);
  } catch (error) {
    console.error("[AI Analyze Monitor] Error fetching test report:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Step 1: Parse and validate input
    const body = await request.json();
    const { monitorId } = validateRequest(body);

    // Step 2: Authentication and authorization
    const session = await AuthService.validateUserAccess(request, monitorId);

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

    // Step 5: Fetch monitor data
    const monitor = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, monitorId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!monitor) {
      return NextResponse.json(
        { success: false, message: "Monitor not found" },
        { status: 404 }
      );
    }

    // Step 5b: Verify monitor belongs to user's organization
    if (activeOrg && monitor.organizationId !== activeOrg.id) {
      return NextResponse.json(
        { success: false, message: "Monitor not found" },
        { status: 404 }
      );
    }

    // Step 6: Fetch recent results (last 10)
    const recentResults = await db
      .select()
      .from(monitorResults)
      .where(eq(monitorResults.monitorId, monitorId))
      .orderBy(desc(monitorResults.checkedAt))
      .limit(10);

    // Step 7: Fetch aggregated stats for the last 24h and 7d
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const results24h = await db
      .select()
      .from(monitorResults)
      .where(
        and(
          eq(monitorResults.monitorId, monitorId),
          gte(monitorResults.checkedAt, twentyFourHoursAgo)
        )
      );

    const results7d = await db
      .select()
      .from(monitorResults)
      .where(
        and(
          eq(monitorResults.monitorId, monitorId),
          gte(monitorResults.checkedAt, sevenDaysAgo)
        )
      );

    // Calculate stats
    const calculateStats = (results: typeof results24h) => {
      if (results.length === 0) {
        return { avgResponseMs: null, p95ResponseMs: null, successRate: null, checkCount: 0 };
      }

      const responseTimes = results
        .map((r) => r.responseTimeMs)
        .filter((t): t is number => t !== null && t !== undefined)
        .sort((a, b) => a - b);

      const upCount = results.filter((r) => r.status === "up").length;
      const successRate = (upCount / results.length) * 100;

      const avgResponseMs = responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;

      const p95Index = Math.floor(responseTimes.length * 0.95);
      const p95ResponseMs = responseTimes.length > 0 ? responseTimes[p95Index] || responseTimes[responseTimes.length - 1] : null;

      return {
        avgResponseMs,
        p95ResponseMs,
        successRate,
        checkCount: results.length,
      };
    };

    const stats24h = calculateStats(results24h);
    const stats7d = calculateStats(results7d);

    // Step 8: For synthetic monitors, fetch HTML report if available
    let testReportHtml: string | null = null;
    const isSynthetic = monitor.type === "synthetic_test";
    
    if (isSynthetic && recentResults.length > 0) {
      // Find the most recent result with a test report URL
      const resultWithReport = recentResults.find((r) => r.testReportS3Url);
      if (resultWithReport?.testReportS3Url) {
        testReportHtml = await getTestReportContent(resultWithReport.testReportS3Url);
      }
    }

    // Step 9: Build AI prompt
    const prompt = AIPromptBuilder.buildMonitorAnalyzePrompt({
      monitor: {
        id: monitor.id,
        name: monitor.name,
        type: monitor.type,
        url: monitor.target || "",
        status: monitor.status as "up" | "down" | "paused",
        config: monitor.config as Record<string, unknown> | null,
      },

      stats24h,
      stats7d,
      recentResults: recentResults.map((r) => ({
        status: r.status as "up" | "down",
        responseTimeMs: r.responseTimeMs,
        errorMessage: r.details && typeof r.details === "object" && "error" in r.details
          ? String(r.details.error)
          : undefined,
        checkedAt: r.checkedAt instanceof Date ? r.checkedAt.toISOString() : String(r.checkedAt),
        location: r.location || undefined,
      })),
      testReportHtml: testReportHtml || undefined,
    });

    // Step 10: Generate streaming AI response
    const aiResponse = await AIStreamingService.generateStreamingResponse({
      prompt,
      maxTokens: 4000,
      temperature: 0.2,
      testType: isSynthetic ? "browser" : "api",
    });

    // Step 11: Log audit event
    try {
      if (activeOrg) {
        await logAuditEvent({
          userId: session.user.id,
          organizationId: activeOrg.id,
          action: "ai_analyze",
          resource: "monitor",
          resourceId: monitorId,
          success: true,
          ipAddress: clientIp,
          metadata: {
            monitorName: monitor.name,
            monitorType: monitor.type,
            model: aiResponse.model,
          },
        });
      }
    } catch (trackingError) {
      console.error("[AI Analyze Monitor] Failed to log audit event:", trackingError);
    }

    // Step 12: Return streaming response
    return new NextResponse(aiResponse.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-AI-Model": aiResponse.model,
        "X-Operation": "analyze-monitor",
      },
    });
  } catch (error) {
    console.error("[AI Analyze Monitor] Streaming failed:", error);

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
          "Failed to generate AI analysis. Please try again or check the monitor manually.",
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
      service: "ai-analyze-monitor-api",
      details: healthStatus.details,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        service: "ai-analyze-monitor-api",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
