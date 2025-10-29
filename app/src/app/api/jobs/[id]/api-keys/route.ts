import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey, jobs, user } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";

// Validation schemas
const createApiKeySchema = z.object({
  name: z.string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters")
    .transform(val => val.trim())
    .refine(val => val.length > 0, "Name cannot be empty after trimming"),
  expiresIn: z.number()
    .min(60, "Expiry must be at least 1 minute")
    .max(365 * 24 * 60 * 60, "Expiry cannot exceed 1 year")
    .optional()
});

// GET /api/jobs/[id]/api-keys - List API keys for a job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;

    // Validate UUID format
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
    }

    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify job exists
    const job = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get API keys that belong to this job, including creator name
    const jobKeys = await db
      .select({
        id: apikey.id,
        name: apikey.name,
        start: apikey.start,
        enabled: apikey.enabled,
        createdAt: apikey.createdAt,
        expiresAt: apikey.expiresAt,
        jobId: apikey.jobId,
        lastRequest: apikey.lastRequest,
        createdByName: user.name,
      })
      .from(apikey)
      .leftJoin(user, eq(apikey.userId, user.id))
      .where(eq(apikey.jobId, jobId))
      .orderBy(apikey.id); // UUIDv7 is time-ordered (PostgreSQL 18+)

    return NextResponse.json({
      success: true,
      apiKeys: jobKeys.map((key) => ({
        id: key.id,
        name: key.name || "Unnamed Key",
        enabled: Boolean(key.enabled),
        createdAt: key.createdAt?.toISOString() || new Date().toISOString(),
        expiresAt: key.expiresAt?.toISOString() || null,
        start: key.start || "unknown",
        jobId: key.jobId,
        lastRequest: key.lastRequest?.toISOString() || null,
        createdByName: key.createdByName || "-",
      })),
    });
  } catch (error) {
    console.error("Error fetching job API keys:", error);
    return NextResponse.json(
      { 
        success: false,
        error: "Failed to fetch API keys",
        apiKeys: []
      },
      { status: 500 }
    );
  }
}

// POST /api/jobs/[id]/api-keys - Create API key for job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;

    // Validate UUID format
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
    }

    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse and validate request body
    let requestBody;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Validate input data
    console.log("API Key Creation - Request body:", JSON.stringify(requestBody, null, 2));
    const validation = createApiKeySchema.safeParse(requestBody);
    if (!validation.success) {
      console.log("API Key Creation - Validation failed:", validation.error.issues);
      return NextResponse.json(
        { 
          error: "Validation failed", 
          details: validation.error.issues.map(err => ({
            field: err.path.join('.') || 'unknown',
            message: err.message || 'Invalid value'
          }))
        },
        { status: 400 }
      );
    }

    const { name, expiresIn } = validation.data;

    // Verify job exists
    const job = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (job.length === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check for duplicate names within the same job
    const existingNamedKey = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(and(
        eq(apikey.jobId, jobId),
        eq(apikey.name, name.trim())
      ))
      .limit(1);

    if (existingNamedKey.length > 0) {
      return NextResponse.json(
        { error: "An API key with this name already exists for this job" },
        { status: 409 }
      );
    }

    // Enforce max 10 keys per job
    const existingKeys = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(eq(apikey.jobId, jobId));
    
    if (existingKeys.length >= 10) {
      return NextResponse.json(
        { error: "Maximum of 10 API keys per job reached" },
        { status: 400 }
      );
    }

    // Generate secure API key
    const apiKeyId = crypto.randomUUID();
    const apiKeyValue = `job_${crypto.randomUUID().replace(/-/g, '')}`;
    const apiKeyStart = apiKeyValue.substring(0, 8);
    
    const now = new Date();
    let expiresAt = null;
    
    if (expiresIn && expiresIn > 0) {
      expiresAt = new Date(now.getTime() + expiresIn * 1000);
      
      // Additional validation: ensure expiry is in the future
      if (expiresAt <= now) {
        return NextResponse.json(
          { error: "Expiry date must be in the future" },
          { status: 400 }
        );
      }
    }
    
    // Create API key with proper error handling
    const newApiKey = await db.insert(apikey).values({
      id: apiKeyId,
      name: name.trim(),
      start: apiKeyStart,
      prefix: "job",
      key: apiKeyValue,
      userId: session.user.id,
      jobId: jobId,
      enabled: true,
      expiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
      permissions: JSON.stringify({
        jobs: [`trigger:${jobId}`],
        scope: "job-specific",
        createdBy: session.user.id
      }),
    }).returning();

    if (!newApiKey || newApiKey.length === 0) {
      throw new Error("Failed to create API key in database");
    }

    const apiKey = newApiKey[0];

    // Get job info for audit logging
    const jobInfo = await db
      .select({ organizationId: jobs.organizationId, projectId: jobs.projectId, name: jobs.name })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    // Log API key creation for audit purposes
    await logAuditEvent({
      userId: session.user.id,
      organizationId: jobInfo[0]?.organizationId || undefined,
      action: 'api_key_created',
      resource: 'api_key',
      resourceId: apiKey.id,
      metadata: {
        apiKeyName: apiKey.name,
        jobId: jobId,
        jobName: jobInfo[0]?.name,
        projectId: jobInfo[0]?.projectId,
        expiresAt: expiresAt?.toISOString(),
        hasExpiry: !!expiresAt
      },
      success: true
    });

    console.log(`API key created: ${apiKey.name} (${apiKey.id}) for job ${jobId} by user ${session.user.id}`);

    return NextResponse.json({
      success: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name || "Unnamed Key",
        key: apiKey.key, // Only returned on creation
        start: apiKey.start || "unknown",
        enabled: Boolean(apiKey.enabled),
        expiresAt: apiKey.expiresAt?.toISOString() || null,
        createdAt: apiKey.createdAt?.toISOString() || new Date().toISOString(),
        jobId: apiKey.jobId,
      },
    });
  } catch (error) {
    console.error("Error creating API key:", error);
    
    // Enhanced error handling
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    const isDbError = errorMessage.includes('connection') || 
                     errorMessage.includes('timeout') || 
                     errorMessage.includes('database');
    
    return NextResponse.json(
      { 
        success: false,
        error: isDbError ? "Database connection issue" : "Failed to create API key",
        details: errorMessage
      },
      { status: isDbError ? 503 : 500 }
    );
  }
} 