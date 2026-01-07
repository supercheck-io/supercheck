import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { requirementDocuments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { fetchFromS3 } from "@/lib/s3-proxy";

const BUCKET_NAME = process.env.S3_REQUIREMENTS_BUCKET_NAME || "test-requirement-artifacts";

/**
 * GET /api/documents/[id]/download
 * 
 * Proxies the document download through the server, avoiding issues with
 * presigned URLs that use internal Docker hostnames (e.g., minio:9000)
 * which are inaccessible from the browser.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: documentId } = await params;
    
    if (!documentId) {
      return new Response(JSON.stringify({ error: "Document ID required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get document to find storage path
    const [doc] = await db
      .select()
      .from(requirementDocuments)
      .where(
        and(
          eq(requirementDocuments.id, documentId),
          eq(requirementDocuments.projectId, project.id)
        )
      )
      .limit(1);

    if (!doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch from S3 and stream to client
    return fetchFromS3(BUCKET_NAME, doc.storagePath, {
      contentDisposition: `attachment; filename="${doc.name}"`,
    });
  } catch (error) {
    console.error("[Documents Download] Error:", error);
    return new Response(JSON.stringify({ error: "Failed to download document" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
