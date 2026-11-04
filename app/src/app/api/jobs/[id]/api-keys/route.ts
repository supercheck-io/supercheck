import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey, jobs, member, user } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import { checkPermissionWithContext, isImpersonatedSession } from "@/lib/rbac/middleware";
import { createLogger } from "@/lib/logger/pino-config";
import { hashApiKey, generateApiKey, getApiKeyPrefix } from "@/lib/security/api-key-hash";
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { capExpiryToCliToken, clampExpiry } from "@/lib/auth/cli-token-expiry";
import crypto from "crypto";

const logger = createLogger({ module: 'api-keys' });

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
    const authCtx = await requireAuthContext();
    const { id: jobId } = await params;

    // Validate UUID format
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
    }

    const canView = checkPermissionWithContext("apiKey", "view", authCtx);
    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Verify job exists (scoped to current project/org)
    const job = await db
      .select({
        id: jobs.id,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.projectId, authCtx.project.id),
          eq(jobs.organizationId, authCtx.organizationId)
        )
      )
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
        createdByImage: user.image,
      })
      .from(apikey)
      .leftJoin(user, eq(apikey.referenceId, user.id))
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
        createdByImage: key.createdByImage ?? null,
      })),
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    logger.error({ err: error }, 'Error fetching job API keys');
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
    const authCtx = await requireAuthContext();
    const { id: jobId } = await params;

    // Validate UUID format
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ error: "Invalid job ID format" }, { status: 400 });
    }

    const userId = authCtx.userId;

    // A trigger key minted while impersonating would belong to the impersonated user.
    if (!authCtx.isCliAuth && (await isImpersonatedSession())) {
      return NextResponse.json(
        { error: "Trigger keys cannot be created while impersonating a user" },
        { status: 403 }
      );
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
    const validation = createApiKeySchema.safeParse(requestBody);
    if (!validation.success) {
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

    const { name } = validation.data;
    const expiresIn = capExpiryToCliToken(authCtx, validation.data.expiresIn);
    if (expiresIn === null) {
      return NextResponse.json({ error: "The CLI token has expired" }, { status: 401 });
    }

    const canCreate = checkPermissionWithContext("apiKey", "create", authCtx);
    if (!canCreate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Verify job exists (scoped to current project/org)
    const job = await db
      .select({
        id: jobs.id,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
        name: jobs.name,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.projectId, authCtx.project.id),
          eq(jobs.organizationId, authCtx.organizationId)
        )
      )
      .limit(1);

    if (job.length === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Generate secure API key using cryptographic utility
    const apiKeyId = crypto.randomUUID();
    const apiKeyValue = generateApiKey(); // Uses crypto.randomBytes for secure generation
    const apiKeyStart = getApiKeyPrefix(apiKeyValue);
    const apiKeyHash = hashApiKey(apiKeyValue); // Hash the key for storage
    
    const now = new Date();
    let expiresAt = expiresIn && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null;
    // Re-clamp to the parent's absolute expiry: the queries above take time.
    expiresAt = clampExpiry(expiresAt, authCtx.isCliAuth ? authCtx.cliTokenExpiresAt : null);

    if (expiresAt) {
      // Additional validation: ensure expiry is in the future
      if (expiresAt <= now) {
        return NextResponse.json(
          { error: "Expiry date must be in the future" },
          { status: 400 }
        );
      }
    }
    
    // The membership re-check, name/cap checks and insert run under one per-job
    // advisory lock, so concurrent requests cannot both pass the cap or name check.
    // SECURITY: Only the hash is stored, the plain key is returned once to the user.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${job[0].id}, 0))`);

      // The lock wait can outlast a short expiry computed before it.
      if (expiresAt && expiresAt <= new Date()) {
        return { error: "Expiry date must be in the future", status: 400 } as const;
      }

      const [stillMember] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, authCtx.organizationId)))
        .limit(1);
      if (!stillMember) return { error: "Insufficient permissions", status: 403 } as const;

      const [existingNamedKey] = await tx
        .select({ id: apikey.id })
        .from(apikey)
        .where(and(eq(apikey.jobId, job[0].id), eq(apikey.name, name.trim())))
        .limit(1);
      if (existingNamedKey) {
        return { error: "An API key with this name already exists for this job", status: 409 } as const;
      }

      const existingKeys = await tx.select({ id: apikey.id }).from(apikey).where(eq(apikey.jobId, job[0].id));
      if (existingKeys.length >= 10) {
        return { error: "Maximum of 10 API keys per job reached", status: 400 } as const;
      }

      const rows = await tx.insert(apikey).values({
        id: apiKeyId,
        configId: "default",
        name: name.trim(),
        start: apiKeyStart,
        prefix: "job",
        key: apiKeyHash, // Store hash instead of plain text
        referenceId: userId,
        jobId: jobId,
        enabled: true,
        expiresAt: expiresAt,
        createdAt: now,
        updatedAt: now,
        permissions: [`trigger:${jobId}`],
      }).returning();
      return { rows } as const;
    });

    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: created.status });
    }
    const newApiKey = created.rows;

    if (!newApiKey || newApiKey.length === 0) {
      throw new Error("Failed to create API key in database");
    }

    const apiKey = newApiKey[0];

    // Get job info for audit logging
    // Log API key creation for audit purposes
    await logAuditEvent({
      userId,
      organizationId: job[0].organizationId || undefined,
      action: 'api_key_created',
      resource: 'api_key',
      resourceId: apiKey.id,
      metadata: {
        apiKeyName: apiKey.name,
        jobId: jobId,
        jobName: job[0]?.name,
        projectId: job[0]?.projectId,
        expiresAt: expiresAt?.toISOString(),
        hasExpiry: !!expiresAt
      },
      success: true
    });

    logger.info({ jobId, apiKeyId: apiKey.id }, 'API key created for job');

    return NextResponse.json({
      success: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name || "Unnamed Key",
        key: apiKeyValue, // Return plain key (shown only once) - NOT the stored hash
        start: apiKey.start || "unknown",
        enabled: Boolean(apiKey.enabled),
        expiresAt: apiKey.expiresAt?.toISOString() || null,
        createdAt: apiKey.createdAt?.toISOString() || new Date().toISOString(),
        jobId: apiKey.jobId,
      },
    }, { status: 201 });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) }
      );
    }
    logger.error({ err: error }, 'Error creating API key');
    
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
