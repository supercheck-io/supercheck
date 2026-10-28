import { isUuid } from "@/lib/uuid";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey, jobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { z } from "zod";

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
}).refine((v) => v.enabled !== undefined || v.name !== undefined, "No fields to update");

// PATCH /api/jobs/[id]/api-keys/[keyId] - Update API key settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    const authCtx = await requireAuthContext();
    const { id: jobId, keyId } = await params;

    const canUpdate = checkPermissionWithContext("apiKey", "update", authCtx);
    if (!canUpdate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const parsed = updateKeySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { enabled, name } = parsed.data;

    if (!isUuid((await params).id) || !isUuid((await params).keyId)) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    const keyRecord = await db
      .select({
        id: apikey.id,
        jobId: apikey.jobId,
        ownerId: apikey.referenceId,
        enabled: apikey.enabled,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
      })
      .from(apikey)
      .leftJoin(jobs, eq(jobs.id, apikey.jobId))
      .where(
        and(
          eq(apikey.id, keyId),
          eq(apikey.jobId, jobId),
          eq(jobs.projectId, authCtx.project.id),
          eq(jobs.organizationId, authCtx.organizationId)
        )
      )
      .limit(1);

    if (!keyRecord.length) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Re-enabling undoes a revocation: only the key's owner or a holder of apiKey:delete may do it.
    if (
      enabled === true &&
      keyRecord[0].enabled === false &&
      keyRecord[0].ownerId !== authCtx.userId &&
      !checkPermissionWithContext("apiKey", "delete", authCtx)
    ) {
      return NextResponse.json({ error: "Only the key's owner or an admin can re-enable it" }, { status: 403 });
    }

    // Update the API key directly in database
    const updateData: Partial<typeof apikey.$inferInsert> = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (name !== undefined) updateData.name = name;
    updateData.updatedAt = new Date();

    const updatedKey = await db
      .update(apikey)
      .set(updateData)
      .where(eq(apikey.id, keyId))
      .returning();

    return NextResponse.json({
      success: true,
      apiKey: updatedKey[0],
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error updating API key:", error);
    return NextResponse.json(
      { error: "Failed to update API key" },
      { status: 500 }
    );
  }
}

// DELETE /api/jobs/[id]/api-keys/[keyId] - Delete API key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    const authCtx = await requireAuthContext();
    const { id: jobId, keyId } = await params;

    const canDelete = checkPermissionWithContext("apiKey", "delete", authCtx);
    if (!canDelete) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    if (!isUuid((await params).id) || !isUuid((await params).keyId)) return NextResponse.json({ error: "API key not found" }, { status: 404 });
    const keyRecord = await db
      .select({
        id: apikey.id,
        jobId: apikey.jobId,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
      })
      .from(apikey)
      .leftJoin(jobs, eq(jobs.id, apikey.jobId))
      .where(
        and(
          eq(apikey.id, keyId),
          eq(apikey.jobId, jobId),
          eq(jobs.projectId, authCtx.project.id),
          eq(jobs.organizationId, authCtx.organizationId)
        )
      )
      .limit(1);

    if (!keyRecord.length) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Delete the API key directly from database
    await db
      .delete(apikey)
      .where(and(eq(apikey.id, keyId), eq(apikey.jobId, jobId)));

    return NextResponse.json({
      success: true,
      message: "API key deleted successfully",
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting API key:", error);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 }
    );
  }
} 
