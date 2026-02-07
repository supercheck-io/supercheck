import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey, user } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  hashApiKey,
  generateCliToken,
  getApiKeyPrefix,
} from "@/lib/security/api-key-hash";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "cli-tokens" });

const createCliTokenSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters")
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, "Name cannot be empty after trimming"),
  expiresIn: z
    .number()
    .min(3600, "Expiry must be at least 1 hour")
    .max(365 * 24 * 60 * 60, "Expiry cannot exceed 1 year")
    .optional(),
});

/**
 * GET /api/cli-tokens — List CLI tokens for the current project
 *
 * Returns all CLI tokens (sck_live_*, sck_test_*) scoped to the current project.
 * Job-scoped trigger keys are excluded (they have a non-null jobId).
 */
export async function GET() {
  try {
    const context = await requireAuthContext();

    const canView = checkPermissionWithContext("apiKey", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const tokens = await db
      .select({
        id: apikey.id,
        name: apikey.name,
        start: apikey.start,
        enabled: apikey.enabled,
        createdAt: apikey.createdAt,
        expiresAt: apikey.expiresAt,
        lastRequest: apikey.lastRequest,
        createdByName: user.name,
      })
      .from(apikey)
      .leftJoin(user, eq(apikey.userId, user.id))
      .where(
        and(
          eq(apikey.projectId, context.project.id),
          isNull(apikey.jobId) // CLI tokens have no jobId
        )
      )
      .orderBy(apikey.createdAt);

    return NextResponse.json({
      success: true,
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name || "Unnamed Token",
        enabled: Boolean(t.enabled),
        createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
        expiresAt: t.expiresAt?.toISOString() || null,
        start: t.start || "sck_...",
        lastRequest: t.lastRequest?.toISOString() || null,
        createdByName: t.createdByName || null,
      })),
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error }, "Error fetching CLI tokens");
    return NextResponse.json(
      { error: "Failed to fetch CLI tokens" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cli-tokens — Create a new CLI token for the current project
 *
 * Generates a project-scoped CLI token (sck_live_*).
 * The plain token is returned once and never stored — only the hash is persisted.
 */
export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    const canCreate = checkPermissionWithContext("apiKey", "create", context);
    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    let requestBody;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const validation = createCliTokenSchema.safeParse(requestBody);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validation.error.issues.map((err) => ({
            field: err.path.join(".") || "unknown",
            message: err.message || "Invalid value",
          })),
        },
        { status: 400 }
      );
    }

    const { name, expiresIn } = validation.data;

    // Enforce max 20 CLI tokens per project
    const existingTokens = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(
        and(
          eq(apikey.projectId, context.project.id),
          isNull(apikey.jobId)
        )
      );

    if (existingTokens.length >= 20) {
      return NextResponse.json(
        { error: "Maximum of 20 CLI tokens per project reached" },
        { status: 400 }
      );
    }

    // Check for duplicate names within the project
    const existingNamed = await db
      .select({ id: apikey.id })
      .from(apikey)
      .where(
        and(
          eq(apikey.projectId, context.project.id),
          isNull(apikey.jobId),
          eq(apikey.name, name)
        )
      )
      .limit(1);

    if (existingNamed.length > 0) {
      return NextResponse.json(
        { error: "A CLI token with this name already exists" },
        { status: 409 }
      );
    }

    // Generate the token
    const tokenValue = generateCliToken(false); // sck_live_*
    const tokenStart = getApiKeyPrefix(tokenValue);
    const tokenHash = hashApiKey(tokenValue);

    const now = new Date();
    let expiresAt: Date | null = null;
    if (expiresIn && expiresIn > 0) {
      expiresAt = new Date(now.getTime() + expiresIn * 1000);
    }

    let newToken;
    try {
      [newToken] = await db
        .insert(apikey)
        .values({
          name,
          start: tokenStart,
          prefix: "cli",
          key: tokenHash,
          userId: context.userId,
          projectId: context.project.id,
          jobId: null, // CLI tokens are not job-scoped
          enabled: true,
          expiresAt,
          createdAt: now,
          updatedAt: now,
          permissions: ["cli:full"],
          metadata: {
            tokenType: "cli_live",
            organizationId: context.organizationId,
          },
        })
        .returning();
    } catch (insertError: unknown) {
      // Handle race condition: concurrent request may have inserted a duplicate name
      const dbErr = insertError as { code?: string; constraint?: string; message?: string };
      if (dbErr?.code === "23505" || dbErr?.constraint?.includes("unique") || dbErr?.message?.includes("duplicate key")) {
        return NextResponse.json(
          { error: "A CLI token with this name already exists" },
          { status: 409 }
        );
      }
      throw insertError;
    }

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "cli_token_created",
      resource: "api_key",
      resourceId: newToken.id,
      metadata: {
        tokenName: name,
        projectId: context.project.id,
        expiresAt: expiresAt?.toISOString(),
      },
      success: true,
    });

    logger.info(
      { projectId: context.project.id, tokenId: newToken.id },
      "CLI token created"
    );

    return NextResponse.json(
      {
        success: true,
        token: {
          id: newToken.id,
          name: newToken.name,
          // SECURITY: Plain token returned once only — not stored
          key: tokenValue,
          start: newToken.start,
          enabled: true,
          expiresAt: expiresAt?.toISOString() || null,
          createdAt: now.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error }, "Error creating CLI token");
    return NextResponse.json(
      { error: "Failed to create CLI token" },
      { status: 500 }
    );
  }
}
