import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";

// PATCH /api/jobs/[id]/api-keys/[keyId] - Update API key settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  try {
    const { keyId } = await params;
    const { enabled, name } = await request.json();

    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const { keyId } = await params;

    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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