import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { apikey, jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission, requireAuth } from "@/lib/rbac/middleware";

// PATCH /api/jobs/[id]/api-keys/[keyId] - Update API key settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    const { id: jobId, keyId } = await params;
    const { enabled, name } = await request.json();

    // Verify user is authenticated
    await requireAuth();

    const keyRecord = await db
      .select({
        id: apikey.id,
        jobId: apikey.jobId,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
      })
      .from(apikey)
      .leftJoin(jobs, eq(jobs.id, apikey.jobId))
      .where(eq(apikey.id, keyId))
      .limit(1);

    if (!keyRecord.length) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    if (keyRecord[0].jobId !== jobId) {
      // Avoid leaking key existence across jobs
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const canUpdate = await hasPermission("apiKey", "update", {
      organizationId: keyRecord[0].organizationId || undefined,
      projectId: keyRecord[0].projectId || undefined,
    });

    if (!canUpdate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
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
    const { id: jobId, keyId } = await params;

    // Verify user is authenticated
    await requireAuth();

    const keyRecord = await db
      .select({
        id: apikey.id,
        jobId: apikey.jobId,
        organizationId: jobs.organizationId,
        projectId: jobs.projectId,
      })
      .from(apikey)
      .leftJoin(jobs, eq(jobs.id, apikey.jobId))
      .where(eq(apikey.id, keyId))
      .limit(1);

    if (!keyRecord.length) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    if (keyRecord[0].jobId !== jobId) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const canDelete = await hasPermission("apiKey", "delete", {
      organizationId: keyRecord[0].organizationId || undefined,
      projectId: keyRecord[0].projectId || undefined,
    });

    if (!canDelete) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    // Delete the API key directly from database
    await db.delete(apikey).where(eq(apikey.id, keyId));

    return NextResponse.json({
      success: true,
      message: "API key deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting API key:", error);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 }
    );
  }
} 
