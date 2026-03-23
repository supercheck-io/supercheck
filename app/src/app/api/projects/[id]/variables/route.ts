import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { createVariableSchema, createFileVariableSchema, MAX_FILE_SIZE, resolveFileMimeType, type VariableType } from "@/lib/validations/variable";
import { encryptValue } from "@/lib/encryption";
import { getS3Client } from "@/lib/s3-proxy";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

const FILE_VARIABLES_BUCKET = process.env.S3_PROJECT_DATA_FILES_BUCKET_NAME || "project-data-files";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUserAuthContext();
    const url = new URL(request.url);
    const projectId =
      url.pathname.split("/projects/")[1]?.split("/")[0] || "";

    // Verify project exists
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

    const organizationId = project[0].organizationId;

    const [canView, canCreate, canDelete, canViewSecrets] = await Promise.all([
      hasPermissionForUser(userId, "variable", "view", {
        organizationId,
        projectId,
      }),
      hasPermissionForUser(userId, "variable", "create", {
        organizationId,
        projectId,
      }),
      hasPermissionForUser(userId, "variable", "delete", {
        organizationId,
        projectId,
      }),
      hasPermissionForUser(userId, "variable", "view_secrets", {
        organizationId,
        projectId,
      }),
    ]);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view variables" },
        { status: 403 }
      );
    }

    // Fetch variables
    // Using ID ordering instead of createdAt since UUIDv7 is time-ordered (PostgreSQL 18+)
    const variables = await db
      .select()
      .from(projectVariables)
      .where(eq(projectVariables.projectId, projectId))
      .orderBy(projectVariables.id);

    // Process variables - never send secret values in list API
    const processedVariables = variables.map((variable) => {
      if (variable.isSecret) {
        return {
          ...variable,
          value: undefined,
          encryptedValue: undefined,
        };
      } else {
        return {
          ...variable,
          encryptedValue: undefined,
        };
      }
    });

    return NextResponse.json({
      success: true,
      data: processedVariables,
      // New names
      canCreate,
      canDelete,
      canViewSecrets,
      // Backward compatibility with old names
      canCreateEdit: canCreate,
      canManage: canDelete,
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error fetching project variables:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split("/projects/")[1]?.split("/")[0] || "";

    const { userId } = await requireUserAuthContext();

    // Verify project exists and user has permission to create variables
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

    const canCreate = await hasPermissionForUser(userId, "variable", "create", {
      organizationId: project[0].organizationId,
      projectId,
    });
    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create variables" },
        { status: 403 }
      );
    }

    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    try {
      if (isMultipart) {
        // File-type variable creation via FormData
        return await handleFileVariableCreate(request, projectId, userId);
      }

      // Standard variable/secret creation via JSON
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

      const validatedData = createVariableSchema.parse(body);
      const effectiveType: VariableType = validatedData.isSecret ? "secret" : (validatedData.type || "variable");

      // File-type variables must be created via multipart/form-data upload, not JSON
      if (effectiveType === "file") {
        return NextResponse.json(
          { error: "File-type variables must be created using file upload (multipart/form-data), not JSON" },
          { status: 400 }
        );
      }

      // Check if variable key already exists for this project
      const existingVariable = await db
        .select()
        .from(projectVariables)
        .where(
          and(
            eq(projectVariables.projectId, projectId),
            eq(projectVariables.key, validatedData.key)
          )
        )
        .limit(1);

      if (existingVariable.length > 0) {
        return NextResponse.json(
          { error: "Variable with this name already exists" },
          { status: 400 }
        );
      }

      // Prepare variable data
      const variableData: Record<string, unknown> = {
        projectId,
        key: validatedData.key,
        isSecret: effectiveType === "secret",
        type: effectiveType,
        description: validatedData.description?.trim() || null,
        createdByUserId: userId,
        value: "",
        encryptedValue: null as string | null,
      };

      if (effectiveType === "secret") {
        // Encrypt the value and store in encryptedValue field
        const encrypted = encryptValue(validatedData.value, projectId);
        variableData.encryptedValue = encrypted;
        variableData.value = "[ENCRYPTED]"; // Placeholder
      } else {
        variableData.value = validatedData.value;
        variableData.encryptedValue = null;
      }

      // Insert the variable
      const [newVariable] = await db
        .insert(projectVariables)
        .values(variableData as typeof projectVariables.$inferInsert)
        .returning();

      // Return the variable (without encrypted data)
      const responseVariable = {
        ...newVariable,
        encryptedValue: undefined,
        value: effectiveType === "secret" ? "[ENCRYPTED]" : newVariable.value,
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

      // Handle unique constraint violation (concurrent create race condition)
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return NextResponse.json(
          { error: "Variable with this name already exists" },
          { status: 400 }
        );
      }

      console.error("Error creating project variable:", error);
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

    console.error("Error creating project variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Handle file-type variable creation from multipart/form-data */
async function handleFileVariableCreate(
  request: NextRequest,
  projectId: string,
  userId: string,
) {
  // Reject obviously oversized requests before buffering the body
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_FILE_SIZE + 1_048_576) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  const formData = await request.formData();
  const key = formData.get("key") as string;
  const description = (formData.get("description") as string) || undefined;
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json(
      { error: "File is required for file-type variables" },
      { status: 400 }
    );
  }

  // Resolve MIME type from browser-provided type or file extension
  const resolvedMimeType = resolveFileMimeType(file);
  if (!resolvedMimeType) {
    return NextResponse.json(
      { error: "Unable to determine file type. Supported extensions: .csv, .json, .txt, .tsv, .xml, .yaml, .yml" },
      { status: 400 }
    );
  }

  // Validate metadata
  const validated = createFileVariableSchema.safeParse({
    key,
    description,
    type: "file",
    fileName: file.name,
    fileSize: file.size,
    mimeType: resolvedMimeType,
  });

  if (!validated.success) {
    return NextResponse.json(
      { error: "Validation error", details: validated.error.errors },
      { status: 400 }
    );
  }

  // Check if variable key already exists
  const existingVariable = await db
    .select()
    .from(projectVariables)
    .where(
      and(
        eq(projectVariables.projectId, projectId),
        eq(projectVariables.key, validated.data.key)
      )
    )
    .limit(1);

  if (existingVariable.length > 0) {
    return NextResponse.json(
      { error: "Variable with this name already exists" },
      { status: 400 }
    );
  }

  // Upload file to S3
  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
      { status: 400 }
    );
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const storagePath = `projects/${projectId}/variables/${Date.now()}-${uniqueId}-${sanitizedFileName}`;

  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: FILE_VARIABLES_BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: resolvedMimeType,
    })
  );

  // Insert the variable record
  let newVariable;
  try {
    [newVariable] = await db
      .insert(projectVariables)
      .values({
        projectId,
        key: validated.data.key,
        value: "", // No text value for file variables
        isSecret: false,
        type: "file",
        fileName: file.name,
        fileSize: file.size,
        mimeType: resolvedMimeType,
        storagePath,
        description: validated.data.description?.trim() || null,
        createdByUserId: userId,
      })
      .returning();
  } catch (dbError) {
    // Clean up orphaned S3 file if DB insert fails
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: FILE_VARIABLES_BUCKET,
          Key: storagePath,
        })
      );
    } catch (cleanupError) {
      console.error("Failed to clean up S3 file after DB insert failure:", cleanupError);
    }
    throw dbError;
  }

  return NextResponse.json({
    success: true,
    data: {
      ...newVariable,
      encryptedValue: undefined,
    },
  });
}
