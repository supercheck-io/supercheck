import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { updateVariableSchema, createFileVariableSchema, MAX_FILE_SIZE, ALLOWED_FILE_MIME_TYPES, resolveFileMimeType, type VariableType } from "@/lib/validations/variable";
import { encryptValue, decryptValue } from "@/lib/encryption";
import { getS3Client } from "@/lib/s3-proxy";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

const FILE_VARIABLES_BUCKET = process.env.S3_PROJECT_DATA_FILES_BUCKET_NAME || "project-data-files";

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
          type: variable.type,
          description: variable.description,
          fileName: variable.fileName,
          fileSize: variable.fileSize,
          mimeType: variable.mimeType,
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
          type: variable.type,
          description: variable.description,
          fileName: variable.fileName,
          fileSize: variable.fileSize,
          mimeType: variable.mimeType,
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

      // Handle file-type variable update via multipart/form-data
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        return await handleFileVariableUpdate(request, existingVariable, projectId, variableId);
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

      // Prevent type changes to/from file via JSON update
      if (existingVariable.type === "file") {
        return NextResponse.json(
          { error: "File-type variables can only be updated via file upload" },
          { status: 400 }
        );
      }

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
        // Keep type column in sync with isSecret flag (matches CLI endpoint behavior)
        updateData.type = validatedData.isSecret ? "secret" : "variable";
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

    // Delete the database row first so the variable is no longer visible.
    // If DB deletion fails, the S3 object is still intact — no corruption.
    await db
      .delete(projectVariables)
      .where(eq(projectVariables.id, variableId));

    // Best-effort S3 cleanup after the row is gone.
    // An orphaned object is harmless; a row pointing at a deleted object is not.
    if (existingVariable.type === "file" && existingVariable.storagePath) {
      try {
        const s3 = getS3Client();
        await s3.send(
          new DeleteObjectCommand({
            Bucket: FILE_VARIABLES_BUCKET,
            Key: existingVariable.storagePath,
          })
        );
      } catch (s3Error) {
        console.error("Failed to delete file from S3:", s3Error);
        // Orphaned S3 object is acceptable — row is already deleted
      }
    }

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

/** Handle file-type variable update from multipart/form-data */
async function handleFileVariableUpdate(
  request: NextRequest,
  existingVariable: typeof projectVariables.$inferSelect,
  projectId: string,
  variableId: string,
) {
  if (existingVariable.type !== "file") {
    return NextResponse.json(
      { error: "Only file-type variables can be updated with file upload" },
      { status: 400 }
    );
  }

  // Reject obviously oversized requests before buffering the body
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_FILE_SIZE + 1_048_576) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  const formData = await request.formData();
  const key = formData.get("key") as string | null;
  const description = formData.get("description") as string | null;
  const file = formData.get("file") as File | null;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  // Validate description length before any side-effects (S3 upload)
  if (description !== null) {
    const normalizedDescription = description.trim();
    if (normalizedDescription.length > 300) {
      return NextResponse.json(
        { error: "Description must be at most 300 characters" },
        { status: 400 }
      );
    }
    updateData.description = normalizedDescription === "" ? null : normalizedDescription;
  }

  // Validate filename length before S3 upload
  if (file && file.name.length > 255) {
    return NextResponse.json(
      { error: "File name must be at most 255 characters" },
      { status: 400 }
    );
  }

  // Persist key changes for file variables (same as text/secret variables)
  if (key !== null && key !== existingVariable.key) {
    // Validate key format
    const keyRegex = /^[A-Z][A-Z0-9_]*$/;
    if (key.length < 4 || key.length > 20) {
      return NextResponse.json(
        { error: "Variable name must be between 4 and 20 characters" },
        { status: 400 }
      );
    }
    if (!keyRegex.test(key)) {
      return NextResponse.json(
        { error: "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores" },
        { status: 400 }
      );
    }
    if (key.startsWith('SUPERCHECK_')) {
      return NextResponse.json(
        { error: "Variable names cannot start with SUPERCHECK_ (reserved)" },
        { status: 400 }
      );
    }
    if (['PATH', 'HOME', 'USER', 'NODE_ENV', 'PORT'].includes(key)) {
      return NextResponse.json(
        { error: "Cannot use system reserved variable names" },
        { status: 400 }
      );
    }
    // Check uniqueness within project
    const existingWithKey = await db
      .select({ id: projectVariables.id })
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.projectId, projectId),
          eq(projectVariables.key, key)
        )
      )
      .limit(1);
    if (existingWithKey.length > 0) {
      return NextResponse.json(
        { error: "Variable with this name already exists" },
        { status: 400 }
      );
    }
    updateData.key = key;
  }

  if (file) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    const effectiveMimeType = resolveFileMimeType(file);
    if (!effectiveMimeType) {
      return NextResponse.json(
        { error: "Unable to determine file type. Supported extensions: .csv, .json, .txt, .tsv, .xml, .yaml, .yml" },
        { status: 400 }
      );
    }
    if (!(ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(effectiveMimeType)) {
      return NextResponse.json(
        { error: `File type '${effectiveMimeType}' not allowed. Supported types: ${ALLOWED_FILE_MIME_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const s3 = getS3Client();

    // Upload new file first (safe: old file still intact if this fails)
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const storagePath = `projects/${projectId}/variables/${Date.now()}-${uniqueId}-${sanitizedFileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: FILE_VARIABLES_BUCKET,
        Key: storagePath,
        Body: buffer,
        ContentType: effectiveMimeType,
      })
    );

    updateData.fileName = file.name;
    updateData.fileSize = file.size;
    updateData.mimeType = effectiveMimeType;
    updateData.storagePath = storagePath;
    updateData._oldStoragePath = existingVariable.storagePath;
  }

  const oldStoragePath = updateData._oldStoragePath as string | undefined;
  delete updateData._oldStoragePath;

  let updatedVariable;
  try {
    [updatedVariable] = await db
      .update(projectVariables)
      .set(updateData)
      .where(eq(projectVariables.id, variableId))
      .returning();
  } catch (dbError) {
    // If we uploaded a new file but DB update failed, clean up the new S3 file
    if (updateData.storagePath && typeof updateData.storagePath === 'string') {
      try {
        const s3 = getS3Client();
        await s3.send(
          new DeleteObjectCommand({
            Bucket: FILE_VARIABLES_BUCKET,
            Key: updateData.storagePath,
          })
        );
      } catch (cleanupError) {
        console.error("Failed to clean up S3 file after DB update failure:", cleanupError);
      }
    }
    throw dbError;
  }

  // Delete old file from S3 after successful DB update (best-effort)
  if (oldStoragePath) {
    try {
      const s3 = getS3Client();
      await s3.send(
        new DeleteObjectCommand({
          Bucket: FILE_VARIABLES_BUCKET,
          Key: oldStoragePath,
        })
      );
    } catch (s3Error) {
      console.error("Failed to delete old file from S3 (orphaned):", s3Error);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      ...updatedVariable,
      encryptedValue: undefined,
    },
  });
}
