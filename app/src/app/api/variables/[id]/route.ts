import { isUuid } from "@/lib/uuid";
/**
 * GET/PUT/DELETE /api/variables/[id]
 *
 * CLI-friendly variable endpoints that use project context from auth token.
 *
 * Multi-tenant scoping: The `projectVariables` table is scoped by `projectId` only
 * (no `organizationId` column). Organization-level isolation is enforced by
 * `requireAuthContext()`, which validates that the resolved project belongs to
 * the authenticated user's organization.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";
import { encryptValue } from "@/lib/encryption";
import { getS3Client } from "@/lib/s3-proxy";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { updateVariableSchema } from "@/lib/validations/variable";

const FILE_VARIABLES_BUCKET = process.env.S3_PROJECT_DATA_FILES_BUCKET_NAME || "project-data-files";

// Drizzle wraps driver errors; the Postgres code lives on `cause`.
const isUniqueViolation = (e: unknown): boolean =>
  [e, (e as { cause?: unknown } | null)?.cause].some(
    (x) => !!x && typeof x === "object" && (x as { code?: unknown }).code === "23505"
  );

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: variableId } = await params;
    const context = await requireAuthContext();

    const canView = checkPermissionWithContext("variable", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    if (!isUuid((await params).id)) return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    const [variable] = await db
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, context.project.id)
        )
      )
      .limit(1);

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...variable,
      value: variable.isSecret ? undefined : variable.value,
      encryptedValue: undefined,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: variableId } = await params;
    const context = await requireAuthContext();

    const canUpdate = checkPermissionWithContext("variable", "update", context);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify variable exists and belongs to project
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    const [existing] = await db
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, context.project.id)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const validation = updateVariableSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input. Check variable fields and try again." },
        { status: 400 }
      );
    }

    const { key, value, isSecret, description } = validation.data;

    // File-type variables require multipart/form-data (available in project UI)
    if (existing.type === "file") {
      return NextResponse.json(
        { error: "File-type variables must be updated using multipart/form-data" },
        { status: 400 }
      );
    }

    const effectiveIsSecret = isSecret ?? existing.isSecret;

    // Check for duplicate key if renaming
    if (key !== undefined && key !== existing.key) {
      const [duplicate] = await db
        .select({ id: projectVariables.id })
        .from(projectVariables)
        .where(
          and(
            eq(projectVariables.projectId, context.project.id),
            eq(projectVariables.key, key)
          )
        )
        .limit(1);

      if (duplicate) {
        return NextResponse.json(
          { error: `A variable with key '${key}' already exists in this project` },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (key !== undefined) updateData.key = key;
    if (description !== undefined) updateData.description = description;
    if (isSecret !== undefined) {
      updateData.isSecret = isSecret;
      // Keep type column in sync with isSecret flag
      updateData.type = isSecret ? "secret" : "variable";
    }

    // Only update value/encryptedValue when a new value is provided
    if (value !== undefined) {
      if (effectiveIsSecret) {
        updateData.encryptedValue = encryptValue(value, context.project.id);
        updateData.value = "[ENCRYPTED]";
      } else {
        updateData.value = value;
        updateData.encryptedValue = null;
      }
    } else if (isSecret !== undefined && isSecret !== existing.isSecret) {
      // isSecret flag changed but no new value — re-encrypt/decrypt existing value
      if (isSecret) {
        // Switching to secret: encrypt the existing plaintext value
        if (!existing.value || existing.value === "[ENCRYPTED]") {
          return NextResponse.json(
            { error: "Cannot mark as secret without providing a value. The existing plaintext is unavailable." },
            { status: 400 }
          );
        }
        updateData.encryptedValue = encryptValue(existing.value, context.project.id);
        updateData.value = "[ENCRYPTED]";
      } else {
        return NextResponse.json(
          { error: "Provide a replacement value to convert a secret to plaintext. Use the audited decrypt action to reveal an existing secret." },
          { status: 400 },
        );
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
      .update(projectVariables)
      .set(updateData)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, context.project.id)
        )
      )
      .returning();

      await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "variable_updated",
      resource: "project_variable",
      resourceId: variableId,
      metadata: {
        projectId: context.project.id,
        key: row.key,
        isSecret: row.isSecret,
        ...(existing.key !== row.key ? { previousKey: existing.key } : {}),
        ...(existing.isSecret !== row.isSecret ? { previousIsSecret: existing.isSecret } : {}),
      },
      success: true,
    }, tx, { strict: true });
      return row;
    });

    return NextResponse.json({
      ...updated,
      value: effectiveIsSecret ? "[ENCRYPTED]" : updated.value,
      encryptedValue: undefined,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Variable with this key already exists" },
        { status: 409 }
      );
    }
    console.error("Error updating variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: variableId } = await params;
    const context = await requireAuthContext();

    const canDelete = checkPermissionWithContext("variable", "delete", context);
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Verify variable exists and belongs to project
    if (!isUuid((await params).id)) return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    const [existing] = await db
      .select({
        id: projectVariables.id,
        type: projectVariables.type,
        storagePath: projectVariables.storagePath,
        key: projectVariables.key,
        isSecret: projectVariables.isSecret,
      })
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, context.project.id)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 }
      );
    }

    // Delete DB row first, then best-effort S3 cleanup
    const didDelete = await db.transaction(async (tx) => {
      const deleted = await tx
      .delete(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, context.project.id)
        )
      ).returning({ id: projectVariables.id });
      if (deleted.length === 0) return false;
      await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "variable_deleted",
      resource: "project_variable",
      resourceId: variableId,
      metadata: { projectId: context.project.id, key: existing.key, isSecret: existing.isSecret },
      success: true,
    }, tx, { strict: true });
      return true;
    });
    if (!didDelete) {
      return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    }

    if (existing.type === "file" && existing.storagePath) {
      try {
        const s3 = getS3Client();
        await s3.send(
          new DeleteObjectCommand({
            Bucket: FILE_VARIABLES_BUCKET,
            Key: existing.storagePath,
          })
        );
      } catch (s3Error) {
        console.error("Failed to delete file from S3:", s3Error);
      }
    }

    return NextResponse.json({ success: true, message: "Variable deleted" });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
