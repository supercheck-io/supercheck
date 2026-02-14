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
import { encryptValue, decryptValue } from "@/lib/encryption";
import { z } from "zod";

const updateVariableSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .optional(),
  value: z.string().max(10000).optional(),
  isSecret: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

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
        { error: "Validation error", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { key, value, isSecret, description } = validation.data;
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
    if (isSecret !== undefined) updateData.isSecret = isSecret;

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
        // Switching from secret to plaintext: decrypt the existing encrypted value
        if (!existing.encryptedValue) {
          return NextResponse.json(
            { error: "Cannot unmark as secret without providing a value. The encrypted value is unavailable." },
            { status: 400 }
          );
        }
        updateData.value = decryptValue(existing.encryptedValue as string, context.project.id);
        updateData.encryptedValue = null;
      }
    }

    const [updated] = await db
      .update(projectVariables)
      .set(updateData)
      .where(eq(projectVariables.id, variableId))
      .returning();

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
    const [existing] = await db
      .select({ id: projectVariables.id })
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

    await db
      .delete(projectVariables)
      .where(eq(projectVariables.id, variableId));

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
