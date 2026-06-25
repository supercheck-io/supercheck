import { PutObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { sreIncidents } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getS3Client } from "@/lib/s3-proxy";
import { checkSreAttachmentUploadRateLimit } from "@/lib/sre/sre-rate-limiter";
import { db } from "@/utils/db";

const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024;
const REQUEST_OVERHEAD_BYTES = 512 * 1024;
const BUCKET_NAME = process.env.S3_SRE_ATTACHMENTS_BUCKET_NAME || "sre-chat-attachments";
const ALLOWED_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication required";
  return NextResponse.json({ error: message }, { status: 401 });
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return sanitized || "attachment";
}

function extensionFor(fileName: string, mimeType: string) {
  const existing = fileName.split(".").pop();
  if (existing && existing.length <= 12 && /^[a-zA-Z0-9]+$/.test(existing)) {
    return existing;
  }

  switch (mimeType) {
    case "text/plain":
      return "txt";
    case "text/markdown":
      return "md";
    case "application/json":
      return "json";
    case "text/csv":
      return "csv";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function hasValidImageSignature(buffer: Buffer, mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/webp":
      return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    default:
      return true;
  }
}

export async function POST(request: NextRequest) {
  let context: Awaited<ReturnType<typeof requireProjectContext>>;
  try {
    context = await requireProjectContext();
  } catch (error) {
    return authErrorResponse(error);
  }

  const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  });
  if (!canInvestigate) {
    return NextResponse.json({ error: "Insufficient permissions to upload SRE chat attachments" }, { status: 403 });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_ATTACHMENT_SIZE + REQUEST_OVERHEAD_BYTES) {
    return NextResponse.json({ error: "Attachment request body too large" }, { status: 413 });
  }

  const formData = await request.formData();
  const incidentId = formData.get("incidentId");
  const file = formData.get("file");

  if (typeof incidentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(incidentId)) {
    return NextResponse.json({ error: "Valid incidentId is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE) {
    return NextResponse.json({ error: "Attachment file size must be between 1 byte and 2MB" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported attachment type" }, { status: 400 });
  }

  const incident = await db.query.sreIncidents.findFirst({
    where: and(
      eq(sreIncidents.id, incidentId),
      eq(sreIncidents.organizationId, context.organizationId),
      eq(sreIncidents.projectId, context.project.id)
    ),
    columns: { id: true },
  });
  if (!incident) {
    return NextResponse.json({ error: "Incident not found or access denied" }, { status: 404 });
  }

  const rateLimit = await checkSreAttachmentUploadRateLimit(context.userId, incidentId);
  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.resetTime ? Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000)) : 60;
    return NextResponse.json(
      { error: "SRE chat attachment upload rate limit reached. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const safeName = sanitizeFileName(file.name);
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const storagePath = `projects/${context.project.id}/sre-chat/${incidentId}/${Date.now()}-${uniqueId}.${extensionFor(safeName, mimeType)}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!hasValidImageSignature(buffer, mimeType)) {
    return NextResponse.json({ error: "Attachment image content does not match its declared type" }, { status: 400 });
  }

  await getS3Client().send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: storagePath,
    Body: buffer,
    ContentType: mimeType,
    Metadata: {
      organizationId: context.organizationId,
      projectId: context.project.id,
      incidentId,
      uploadedByUserId: context.userId,
    },
  }));

  await logAuditEvent({
    userId: context.userId,
    organizationId: context.organizationId,
    action: "sre_chat_attachment_uploaded",
    resource: "sre_incident",
    resourceId: incidentId,
    metadata: { projectId: context.project.id, storageBucket: BUCKET_NAME, storagePath, mimeType, size: file.size },
    success: true,
  });

  return NextResponse.json({
    attachment: {
      type: "file",
      title: safeName,
      fileName: safeName,
      mimeType,
      size: file.size,
      storageBucket: BUCKET_NAME,
      storagePath,
      incidentId,
    },
  });
}
