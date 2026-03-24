import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveProjectPermissionContext, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getS3Client } from "@/lib/s3-proxy";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ALLOWED_FILE_MIME_TYPES } from "@/lib/validations/variable";

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

    const permCtx = await resolveProjectPermissionContext(userId, projectId);
    if (!permCtx) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    if (!checkPermissionWithContext("variable", "view", permCtx)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
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

    if (variable.type !== "file" || !variable.storagePath) {
      return NextResponse.json(
        { error: "Variable is not a file type" },
        { status: 400 }
      );
    }

    // Fetch file from S3
    const s3 = getS3Client();
    const s3Response = await s3.send(
      new GetObjectCommand({
        Bucket: FILE_VARIABLES_BUCKET,
        Key: variable.storagePath,
      })
    );

    if (!s3Response.Body) {
      return NextResponse.json(
        { error: "File content not found" },
        { status: 404 }
      );
    }

    // Validate MIME type — serve safe fallback if stored type is unexpected
    let contentType = variable.mimeType || "application/octet-stream";
    if (
      variable.mimeType &&
      !(ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(variable.mimeType)
    ) {
      console.warn(
        `Variable ${variableId}: stored mimeType "${variable.mimeType}" not in allowed list, serving as application/octet-stream`
      );
      contentType = "application/octet-stream";
    }

    // Stream the S3 response directly instead of buffering in memory
    const stream = s3Response.Body.transformToWebStream();

    const fileName = variable.fileName || "file";
    const encodedFileName = encodeURIComponent(fileName);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
    };
    if (s3Response.ContentLength !== undefined) {
      headers["Content-Length"] = String(s3Response.ContentLength);
    }

    return new NextResponse(stream, { status: 200, headers });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }

    console.error("Error downloading file variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
