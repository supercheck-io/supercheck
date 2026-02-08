import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "cli-tokens" });

const updateCliTokenSchema = z.object({
  enabled: z.boolean().optional(),
  name: z
    .string()
    .min(1, "Name cannot be empty")
    .max(100, "Name must be less than 100 characters")
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, "Name cannot be empty after trimming")
    .optional(),
});

/**
 * PATCH /api/cli-tokens/[id] — Enable/disable a CLI token
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tokenId } = await params;
    const context = await requireAuthContext();

    const canUpdate = checkPermissionWithContext("apiKey", "update", context);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const validation = updateCliTokenSchema.safeParse(body);
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

    const { enabled, name } = validation.data;

    // Require at least one field to update
    if (enabled === undefined && name === undefined) {
      return NextResponse.json(
        { error: "No update fields provided. Specify 'enabled' or 'name'." },
        { status: 400 }
      );
    }

    // Verify the token belongs to this project and is a CLI token (no jobId)
    const tokenRecord = await db
      .select({ id: apikey.id, projectId: apikey.projectId, jobId: apikey.jobId })
      .from(apikey)
      .where(
        and(
          eq(apikey.id, tokenId),
          eq(apikey.projectId, context.project.id),
          isNull(apikey.jobId)
        )
      )
      .limit(1);

    if (tokenRecord.length === 0) {
      return NextResponse.json({ error: "CLI token not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (enabled !== undefined) updateData.enabled = enabled;
    if (name !== undefined) updateData.name = name;

    const [updated] = await db
      .update(apikey)
      .set(updateData)
      .where(eq(apikey.id, tokenId))
      .returning();

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "cli_token_updated",
      resource: "api_key",
      resourceId: tokenId,
      metadata: { enabled, name },
      success: true,
    });

    return NextResponse.json({
      success: true,
      token: {
        id: updated.id,
        name: updated.name,
        enabled: updated.enabled,
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error }, "Error updating CLI token");
    return NextResponse.json(
      { error: "Failed to update CLI token" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cli-tokens/[id] — Revoke (permanently delete) a CLI token
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tokenId } = await params;
    const context = await requireAuthContext();

    const canDelete = checkPermissionWithContext("apiKey", "delete", context);
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify the token belongs to this project and is a CLI token
    const tokenRecord = await db
      .select({ id: apikey.id, projectId: apikey.projectId, jobId: apikey.jobId })
      .from(apikey)
      .where(
        and(
          eq(apikey.id, tokenId),
          eq(apikey.projectId, context.project.id),
          isNull(apikey.jobId)
        )
      )
      .limit(1);

    if (tokenRecord.length === 0) {
      return NextResponse.json({ error: "CLI token not found" }, { status: 404 });
    }

    await db.delete(apikey).where(eq(apikey.id, tokenId));

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "cli_token_revoked",
      resource: "api_key",
      resourceId: tokenId,
      metadata: { projectId: context.project.id },
      success: true,
    });

    logger.info({ tokenId, projectId: context.project.id }, "CLI token revoked");

    return NextResponse.json({
      success: true,
      message: "CLI token revoked successfully",
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    logger.error({ err: error }, "Error revoking CLI token");
    return NextResponse.json(
      { error: "Failed to revoke CLI token" },
      { status: 500 }
    );
  }
}
