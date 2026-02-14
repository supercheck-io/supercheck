import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { updateVariableSchema } from "@/lib/validations/variable";
import { encryptValue, decryptValue } from "@/lib/encryption";
import { z } from "zod";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; variableId: string }> }
) {
  try {
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const variableId = resolvedParams.variableId;

    const { userId } = await requireUserAuthContext();

    // Get project info for organization ID
    const project = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const canView = await hasPermissionForUser(userId, "variable", "view", {
      organizationId: project[0].organizationId,
      projectId,
    });

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view variables" },
        { status: 403 }
      );
    }

    // Get the variable
    const [variable] = await db
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, projectId)
        )
      );

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 }
      );
    }

    // Return masked value for secrets. Use dedicated decrypt endpoint for explicit reveal.
    if (variable.isSecret) {
      return NextResponse.json({
        success: true,
        data: {
          id: variable.id,
          projectId: variable.projectId,
          key: variable.key,
          value: "[ENCRYPTED]",
          isSecret: variable.isSecret,
          description: variable.description,
          createdByUserId: variable.createdByUserId,
          createdAt: variable.createdAt,
          updatedAt: variable.updatedAt,
        },
      });
    } else {
      // Regular variable, return as is
      return NextResponse.json({
        success: true,
        data: {
          id: variable.id,
          projectId: variable.projectId,
          key: variable.key,
          value: variable.value,
          isSecret: variable.isSecret,
          description: variable.description,
          createdByUserId: variable.createdByUserId,
          createdAt: variable.createdAt,
          updatedAt: variable.updatedAt,
        },
      });
    }
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
  { params }: { params: Promise<{ id: string; variableId: string }> }
) {
  try {
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const variableId = resolvedParams.variableId;

    const { userId } = await requireUserAuthContext();

    // Get project info for organization ID
    const project = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const canUpdate = await hasPermissionForUser(userId, "variable", "update", {
      organizationId: project[0].organizationId,
      projectId,
    });
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions to update variables" },
        { status: 403 }
      );
    }

    try {

      // Check if variable exists and belongs to the project
      const [existingVariable] = await db
        .select()
        .from(projectVariables)
        .where(
          and(
            eq(projectVariables.id, variableId),
            eq(projectVariables.projectId, projectId)
          )
        );

      if (!existingVariable) {
        return NextResponse.json(
          { error: "Variable not found" },
          { status: 404 }
        );
      }

      let body;
      try {
        body = await request.json();
      } catch (parseError) {
        console.error("Invalid JSON in request body:", parseError);
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }

      const validatedData = updateVariableSchema.parse(body);

      // If key is being changed, check for conflicts
      if (validatedData.key && validatedData.key !== existingVariable.key) {
        const conflictingVariable = await db
          .select()
          .from(projectVariables)
          .where(
            and(
              eq(projectVariables.projectId, projectId),
              eq(projectVariables.key, validatedData.key)
            )
          )
          .limit(1);

        if (conflictingVariable.length > 0) {
          return NextResponse.json(
            { error: "Variable with this name already exists" },
            { status: 400 }
          );
        }
      }

      const effectiveIsSecret = validatedData.isSecret ?? existingVariable.isSecret;

      // Prepare update data
      const updateData: Record<string, string | boolean | Date | null> = {
        updatedAt: new Date(),
      };

      if (validatedData.key !== undefined) {
        updateData.key = validatedData.key;
      }

      if (validatedData.description !== undefined) {
        const normalizedDescription = validatedData.description.trim();
        updateData.description = normalizedDescription === "" ? null : normalizedDescription;
      }

      if (validatedData.isSecret !== undefined) {
        updateData.isSecret = validatedData.isSecret;
      }

      // Handle value transition/update rules
      if (validatedData.value !== undefined) {
        if (effectiveIsSecret) {
          updateData.encryptedValue = encryptValue(validatedData.value, projectId);
          updateData.value = "[ENCRYPTED]";
        } else {
          updateData.value = validatedData.value;
          updateData.encryptedValue = null;
        }
      } else if (
        validatedData.isSecret !== undefined &&
        validatedData.isSecret !== existingVariable.isSecret
      ) {
        if (validatedData.isSecret) {
          if (!existingVariable.value || existingVariable.value === "[ENCRYPTED]") {
            return NextResponse.json(
              {
                error:
                  "Cannot mark as secret without providing a value. The existing plaintext is unavailable.",
              },
              { status: 400 }
            );
          }

          updateData.encryptedValue = encryptValue(existingVariable.value, projectId);
          updateData.value = "[ENCRYPTED]";
        } else {
          if (!existingVariable.encryptedValue) {
            return NextResponse.json(
              {
                error:
                  "Cannot unmark as secret without providing a value. The encrypted value is unavailable.",
              },
              { status: 400 }
            );
          }

          try {
            updateData.value = decryptValue(existingVariable.encryptedValue, projectId);
            updateData.encryptedValue = null;
          } catch {
            return NextResponse.json(
              { error: "Cannot decrypt existing secret value" },
              { status: 400 }
            );
          }
        }
      }

      // Update the variable
      const [updatedVariable] = await db
        .update(projectVariables)
        .set(updateData)
        .where(eq(projectVariables.id, variableId))
        .returning();

      // Return the variable without encrypted data
      const responseVariable = {
        ...updatedVariable,
        encryptedValue: undefined,
        value: effectiveIsSecret ? "[ENCRYPTED]" : updatedVariable.value,
      };

      return NextResponse.json({
        success: true,
        data: responseVariable,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Validation error", details: error.errors },
          { status: 400 }
        );
      }

      console.error("Error updating project variable:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error updating project variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; variableId: string }> }
) {
  try {
    const resolvedParams = await params;
    const projectId = resolvedParams.id;
    const variableId = resolvedParams.variableId;

    const { userId } = await requireUserAuthContext();

    // Get project info for organization ID
    const project = await db
      .select({ id: projects.id, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const canDelete = await hasPermissionForUser(userId, "variable", "delete", {
      organizationId: project[0].organizationId,
      projectId,
    });
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete variables" },
        { status: 403 }
      );
    }

    // Check if variable exists and belongs to the project
    const [existingVariable] = await db
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.id, variableId),
          eq(projectVariables.projectId, projectId)
        )
      );

    if (!existingVariable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 }
      );
    }

    // Delete the variable
    await db
      .delete(projectVariables)
      .where(eq(projectVariables.id, variableId));

    return NextResponse.json({
      success: true,
      message: "Variable deleted successfully",
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error deleting project variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
