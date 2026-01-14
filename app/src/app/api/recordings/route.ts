import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/utils/db";
import { tests, projects, apikey } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAuditEvent } from "@/lib/audit-logger";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getUserRole, getUserAssignedProjects } from "@/lib/rbac/middleware";
import { hasPermission as checkPermission } from "@/lib/rbac/permissions";
import { verifyApiKey } from "@/lib/security/api-key-hash";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "recordings" });

const recordingSchema = z.object({
  projectId: z.string().uuid("Invalid project ID format"),
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be less than 255 characters")
    .transform((val) => val.trim()),
  script: z.string().min(1, "Script is required"),
  metadata: z.object({
    recordedAt: z.string(),
    duration: z.number().int().nonnegative(),
    stepsCount: z.number().int().nonnegative(),
    baseUrl: z.string().url(),
    browserInfo: z.string().optional(),
    extensionVersion: z.string().optional(),
  }),
});

/**
 * POST /api/recordings
 * Save a recorded script as a new test
 * 
 * Authentication: API Key (X-API-Key header)
 * Used by: SuperCheck Recorder Chrome Extension
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // ========================================
    // AUTHENTICATION - API Key
    // ========================================
    const apiKeyHeader = request.headers.get("X-API-Key");

    if (!apiKeyHeader) {
      return NextResponse.json(
        {
          success: false,
          error: "API key required",
          message: "Provide X-API-Key header",
        },
        { status: 401 }
      );
    }

    // Use SuperCheck's hash-based verification pattern
    const allKeys = await db
      .select({
        id: apikey.id,
        key: apikey.key,
        userId: apikey.userId,
        enabled: apikey.enabled,
        expiresAt: apikey.expiresAt,
      })
      .from(apikey)
      .where(eq(apikey.enabled, true));

    let matchedKey = null;
    for (const key of allKeys) {
      if (verifyApiKey(apiKeyHeader, key.key)) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      logger.warn(
        { keyPrefix: apiKeyHeader.substring(0, 8) },
        "Invalid API key attempt"
      );
      return NextResponse.json(
        { success: false, error: "Invalid API key" },
        { status: 401 }
      );
    }

    if (matchedKey.expiresAt && new Date() > matchedKey.expiresAt) {
      return NextResponse.json(
        { success: false, error: "API key expired" },
        { status: 401 }
      );
    }

    const userId = matchedKey.userId;

    // ========================================
    // REQUEST VALIDATION
    // ========================================
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const validation = recordingSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: validation.error.issues.map((err) => ({
            field: err.path.join(".") || "unknown",
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    const data = validation.data;

    // ========================================
    // PROJECT AUTHORIZATION
    // ========================================
    const project = await db
      .select({
        id: projects.id,
        name: projects.name,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.id, data.projectId))
      .limit(1);

    if (project.length === 0) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Build permission context for the API key user (not session-based)
    // This is required because this endpoint uses API key authentication
    const userRole = await getUserRole(userId, project[0].organizationId || undefined);
    const assignedProjects = await getUserAssignedProjects(userId);
    
    const permissionContext = {
      userId,
      role: userRole,
      organizationId: project[0].organizationId || undefined,
      projectId: data.projectId,
      assignedProjectIds: assignedProjects,
    };

    const canCreate = checkPermission(permissionContext, "test", "create");

    if (!canCreate) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // ========================================
    // SUBSCRIPTION VALIDATION
    // ========================================
    if (project[0].organizationId) {
      try {
        await subscriptionService.blockUntilSubscribed(
          project[0].organizationId
        );
        await subscriptionService.requireValidPolarCustomer(
          project[0].organizationId
        );
      } catch (error) {
        logger.warn(
          { orgId: project[0].organizationId },
          "Subscription validation failed"
        );
        return NextResponse.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Subscription required",
          },
          { status: 402 }
        );
      }
    }

    // ========================================
    // CREATE TEST
    // ========================================
    const [newTest] = await db
      .insert(tests)
      .values({
        projectId: data.projectId,
        organizationId: project[0].organizationId,
        createdByUserId: userId,
        title: data.name,
        description: `Recorded with SuperCheck Recorder on ${new Date(
          data.metadata.recordedAt
        ).toLocaleString()}\n\nBase URL: ${data.metadata.baseUrl}\nSteps: ${data.metadata.stepsCount}\nDuration: ${Math.round(data.metadata.duration / 1000)}s`,
        type: "browser",
        script: data.script,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: tests.id });

    const testId = newTest.id;

    // ========================================
    // AUDIT LOG
    // ========================================
    await logAuditEvent({
      userId,
      organizationId: project[0].organizationId || undefined,
      action: "test_created",
      resource: "test",
      resourceId: testId,
      metadata: {
        source: "recorder_extension",
        projectId: data.projectId,
        projectName: project[0].name,
        testName: data.name,
        extensionVersion: data.metadata.extensionVersion,
        recordingDuration: data.metadata.duration,
        stepsCount: data.metadata.stepsCount,
      },
      success: true,
    });

    const duration = Date.now() - startTime;
    logger.info({ testId, projectId: data.projectId, duration }, "Recording saved");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    return NextResponse.json(
      {
        success: true,
        data: {
          testId,
          redirectUrl: `${baseUrl}/tests/${testId}`,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ err: error }, "Failed to save recording");

    return NextResponse.json(
      { success: false, error: "Failed to save recording" },
      { status: 500 }
    );
  }
}
