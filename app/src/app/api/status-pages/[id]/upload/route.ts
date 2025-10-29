import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { generateProxyUrl } from "@/lib/asset-proxy";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { v4 as uuidv4 } from "uuid";

// S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: true, // Required for MinIO
});

// Use dedicated status page bucket
const BUCKET_NAME =
  process.env.S3_STATUS_BUCKET_NAME || "supercheck-status-artifacts";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/svg+xml",
  "image/webp",
];

type UploadType = "favicon" | "logo" | "cover";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    // Await params
    const params = await context.params;
    const statusPageId = params.id;

    // Check authentication and permissions
    const { organizationId, project } = await requireProjectContext();
    console.log(
      "[UPLOAD] Organization ID:",
      organizationId,
      "Project ID:",
      project.id
    );
    await requirePermissions(
      { status_page: ["update"] },
      { organizationId, projectId: project.id }
    );

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const uploadType = formData.get("type") as UploadType | null;

    if (!file) {
      return NextResponse.json(
        { success: false, message: "No file provided" },
        { status: 400 }
      );
    }

    if (!uploadType || !["favicon", "logo", "cover"].includes(uploadType)) {
      return NextResponse.json(
        { success: false, message: "Invalid upload type" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          message: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Invalid file type. Only images are allowed (PNG, JPG, GIF, SVG, WebP)",
        },
        { status: 400 }
      );
    }

    // Check if status page exists
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, statusPageId),
    });

    if (!statusPage) {
      return NextResponse.json(
        { success: false, message: "Status page not found" },
        { status: 404 }
      );
    }

    // Generate unique filename
    const fileExtension = file.name.split(".").pop() || "png";
    const uniqueId = uuidv4();
    const fileName = `${uniqueId}.${fileExtension}`;

    // S3 key structure: status-pages/{statusPageId}/{uploadType}/{filename}
    const s3Key = `status-pages/${statusPageId}/${uploadType}/${fileName}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
      CacheControl: "public, max-age=31536000", // Cache for 1 year
    });

    await s3Client.send(uploadCommand);

    // Store the S3 key in the database (not the full URL)
    // We'll use proxy URLs when fetching the status page
    // This avoids the varchar(500) limit and allows URLs to be regenerated
    console.log(`[UPLOAD] Successfully uploaded ${uploadType} to S3: ${s3Key}`);

    // Update database with S3 key
    const updateData: {
      faviconLogo?: string;
      transactionalLogo?: string;
      heroCover?: string;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    // Store S3 key format: bucket/key
    const s3Reference = `${BUCKET_NAME}/${s3Key}`;

    if (uploadType === "favicon") {
      updateData.faviconLogo = s3Reference;
    } else if (uploadType === "logo") {
      updateData.transactionalLogo = s3Reference;
    } else if (uploadType === "cover") {
      updateData.heroCover = s3Reference;
    }

    await db
      .update(statusPages)
      .set(updateData)
      .where(eq(statusPages.id, statusPageId));

    // Generate proxy URL for the response (instead of presigned URL)
    const proxyUrl = generateProxyUrl(s3Reference);

    console.log(
      `[UPLOAD] Successfully stored ${uploadType} for status page ${statusPageId}: ${s3Reference}`
    );

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully",
      url: proxyUrl, // Return proxy URL for immediate display
      s3Key: s3Reference, // Also return the S3 reference
      type: uploadType,
    });
  } catch (error) {
    console.error("[UPLOAD] Error uploading file:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to upload file",
      },
      { status: 500 }
    );
  }
}
