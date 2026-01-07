"use server";

import { db } from "@/utils/db";
import { requirementDocuments, requirements as requirementsTable } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client } from "@/lib/s3-proxy";

const BUCKET_NAME = process.env.S3_REQUIREMENTS_BUCKET_NAME || "test-requirement-artifacts";

export type RequirementDocument = typeof requirementDocuments.$inferSelect & {
  extractedCount?: number;
};

/**
 * Get all documents for the current project with extracted requirements count
 */
export async function getDocuments(): Promise<{ success: boolean; documents?: RequirementDocument[]; error?: string }> {
  try {
    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Query documents with extracted requirements count using subquery
    const docs = await db
      .select({
        id: requirementDocuments.id,
        organizationId: requirementDocuments.organizationId,
        projectId: requirementDocuments.projectId,
        name: requirementDocuments.name,
        type: requirementDocuments.type,
        storagePath: requirementDocuments.storagePath,
        fileSize: requirementDocuments.fileSize,
        uploadedByUserId: requirementDocuments.uploadedByUserId,
        uploadedAt: requirementDocuments.uploadedAt,
        createdAt: requirementDocuments.createdAt,
        extractedCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM requirements 
          WHERE requirements.source_document_id = requirement_documents.id
        )`.as("extracted_count"),
      })
      .from(requirementDocuments)
      .where(eq(requirementDocuments.projectId, project.id))
      .orderBy(desc(requirementDocuments.uploadedAt));

    return { success: true, documents: docs };
  } catch (error) {
    console.error("Error fetching documents:", error);
    return { success: false, error: "Failed to fetch documents" };
  }
}

/**
 * Get a single document by ID
 */
export async function getDocument(documentId: string): Promise<{ success: boolean; document?: RequirementDocument; error?: string }> {
  try {
    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    const [doc] = await db
      .select({
        id: requirementDocuments.id,
        organizationId: requirementDocuments.organizationId,
        projectId: requirementDocuments.projectId,
        name: requirementDocuments.name,
        type: requirementDocuments.type,
        storagePath: requirementDocuments.storagePath,
        fileSize: requirementDocuments.fileSize,
        uploadedByUserId: requirementDocuments.uploadedByUserId,
        uploadedAt: requirementDocuments.uploadedAt,
        createdAt: requirementDocuments.createdAt,
        extractedCount: sql<number>`(
          SELECT COUNT(*)::int 
          FROM requirements 
          WHERE requirements.source_document_id = requirement_documents.id
        )`.as("extracted_count"),
      })
      .from(requirementDocuments)
      .where(
        and(
          eq(requirementDocuments.id, documentId),
          eq(requirementDocuments.projectId, project.id)
        )
      )
      .limit(1);

    if (!doc) {
      return { success: false, error: "Document not found" };
    }

    return { success: true, document: doc };
  } catch (error) {
    console.error("Error fetching document:", error);
    return { success: false, error: "Failed to fetch document" };
  }
}

/**
 * Get requirements extracted from a specific document
 */
export async function getDocumentRequirements(documentId: string): Promise<{ 
  success: boolean; 
  requirements?: { id: string; title: string; priority: string | null; createdAt: Date | null }[]; 
  error?: string 
}> {
  try {
    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
    }

    const reqs = await db
      .select({
        id: requirementsTable.id,
        title: requirementsTable.title,
        priority: requirementsTable.priority,
        createdAt: requirementsTable.createdAt,
      })
      .from(requirementsTable)
      .where(
        and(
          eq(requirementsTable.sourceDocumentId, documentId),
          eq(requirementsTable.projectId, project.id)
        )
      )
      .orderBy(desc(requirementsTable.createdAt));

    return { success: true, requirements: reqs };
  } catch (error) {
    console.error("Error fetching document requirements:", error);
    return { success: false, error: "Failed to fetch requirements" };
  }
}

/**
 * Generate a presigned download URL for a document
 */
export async function getDocumentDownloadUrl(documentId: string): Promise<{ success: boolean; url?: string; filename?: string; error?: string }> {
  try {
    const { project, organizationId } = await requireProjectContext();

    const canView = await hasPermission("requirement", "view", {
      organizationId,
      projectId: project.id,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions" };
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
      return { success: false, error: "Document not found" };
    }

    // Generate presigned URL (valid for 15 minutes)
    const s3 = getS3Client();
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: doc.storagePath,
      ResponseContentDisposition: `attachment; filename="${doc.name}"`,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 900 });

    return { success: true, url, filename: doc.name };
  } catch (error) {
    console.error("Error generating download URL:", error);
    return { success: false, error: "Failed to generate download URL" };
  }
}

/**
 * Delete a document
 */
export async function deleteDocument(documentId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { project, organizationId, userId } = await requireProjectContext();

    const canDelete = await hasPermission("requirement", "delete", {
      organizationId,
      projectId: project.id,
    });

    if (!canDelete) {
      return { success: false, error: "Insufficient permissions" };
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
      return { success: false, error: "Document not found" };
    }

    // Delete from S3
    const s3 = getS3Client();
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: doc.storagePath,
      }));
    } catch (s3Error) {
      console.error("Error deleting from S3:", s3Error);
      // Continue to delete from DB even if S3 fails (orphan cleanup later)
    }

    // Delete from DB (requirements with sourceDocumentId will have it set to NULL due to onDelete: "set null")
    await db.delete(requirementDocuments).where(eq(requirementDocuments.id, documentId));

    await logAuditEvent({
        userId,
        action: "document_deleted",
        resource: "requirement_document",
        resourceId: documentId,
        metadata: {
            organizationId,
            projectId: project.id,
            documentName: doc.name
        },
        success: true
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting document:", error);
    return { success: false, error: "Failed to delete document" };
  }
}
