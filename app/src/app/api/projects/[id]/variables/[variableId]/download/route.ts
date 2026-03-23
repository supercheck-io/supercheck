import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { projectVariables, projects } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getS3Client } from "@/lib/s3-proxy";
import { GetObjectCommand } from "@aws-sdk/client-s3";

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

    const canView = await hasPermissionForUser(userId, "variable", "view", {
      organizationId: project[0].organizationId,
      projectId,
    });

    if (!canView) {
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

    // Convert the response body to a buffer
    const chunks: Uint8Array[] = [];
    const reader = s3Response.Body.transformToWebStream().getReader();
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(result.value);
      }
    }
    const buffer = Buffer.concat(chunks);

    const fileName = variable.fileName || "file";
    const encodedFileName = encodeURIComponent(fileName);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": variable.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
        "Content-Length": String(buffer.length),
      },
    });
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
