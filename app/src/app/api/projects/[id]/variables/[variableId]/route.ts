import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/utils/db";
import { auth } from "@/utils/auth";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  canUpdateVariableInProject,
  canDeleteVariableInProject,
  canViewSecretVariableInProject,
} from "@/lib/rbac/middleware";
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

    // Get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get project info for organization ID
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
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

    // Check if user can view secret values using centralized function
    const canViewSecrets = await canViewSecretVariableInProject(
      userId,
      projectId
    );

    // Return variable with decrypted value if permitted
    if (variable.isSecret) {
      if (canViewSecrets && variable.encryptedValue) {
        try {
          const decryptedValue = decryptValue(variable.encryptedValue, projectId);
          return NextResponse.json({
            success: true,
            data: {
              id: variable.id,
              projectId: variable.projectId,
              key: variable.key,
              value: decryptedValue, // Return decrypted value
              isSecret: variable.isSecret,
              description: variable.description,
              createdByUserId: variable.createdByUserId,
              createdAt: variable.createdAt,
              updatedAt: variable.updatedAt,
            },
          });
        } catch (error) {
          console.error("Failed to decrypt value:", error);
          return NextResponse.json(
            { error: "Failed to decrypt secret value" },
            { status: 500 }
          );
        }
      } else {
        // User can't view secrets, return encrypted placeholder
        return NextResponse.json({
          success: true,
          data: {
            id: variable.id,
            projectId: variable.projectId,
            key: variable.key,
            value: "[ENCRYPTED]", // Don't expose encrypted value
            isSecret: variable.isSecret,
            description: variable.description,
            createdByUserId: variable.createdByUserId,
            createdAt: variable.createdAt,
            updatedAt: variable.updatedAt,
          },
        });
      }
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

    // Get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get project info for organization ID
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check permission to update variables using centralized function
    const canUpdate = await canUpdateVariableInProject(userId, projectId);
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

      // Prepare update data
      const updateData: Record<string, string | boolean | Date | null> = {
        updatedAt: new Date(),
      };

      if (validatedData.key !== undefined) {
        updateData.key = validatedData.key;
      }

      if (validatedData.description !== undefined) {
        updateData.description = validatedData.description;
      }

      if (validatedData.isSecret !== undefined) {
        updateData.isSecret = validatedData.isSecret;
      }

      // Handle value update
      if (validatedData.value !== undefined) {
        if (validatedData.isSecret ?? existingVariable.isSecret) {
          // Encrypt the new value
          const encrypted = encryptValue(validatedData.value, projectId);
          updateData.encryptedValue = encrypted;
          updateData.value = "[ENCRYPTED]";
        } else {
          // Store as plain text
          updateData.value = validatedData.value;
          updateData.encryptedValue = null;
        }
      }

      // If changing from secret to non-secret, decrypt the value
      if (validatedData.isSecret === false && existingVariable.isSecret) {
        try {
          const decryptedValue = decryptValue(
            existingVariable.encryptedValue || "",
            projectId
          );
          updateData.value = decryptedValue;
          updateData.encryptedValue = null;
        } catch {
          return NextResponse.json(
            { error: "Cannot decrypt existing secret value" },
            { status: 400 }
          );
        }
      }

      // If changing from non-secret to secret, encrypt the existing value
      if (validatedData.isSecret === true && !existingVariable.isSecret) {
        const valueToEncrypt = validatedData.value || existingVariable.value;
        const encrypted = encryptValue(valueToEncrypt, projectId);
        updateData.encryptedValue = encrypted;
        updateData.value = "[ENCRYPTED]";
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
        value: updatedVariable.isSecret ? "[ENCRYPTED]" : updatedVariable.value,
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

    // Get authenticated user
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get project info for organization ID
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project.length) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check permission to delete variables using centralized function
    const canDelete = await canDeleteVariableInProject(userId, projectId);
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
    console.error("Error deleting project variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
