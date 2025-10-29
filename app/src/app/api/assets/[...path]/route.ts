import { NextRequest, NextResponse } from "next/server";
import { fetchFromS3 } from "@/lib/s3-proxy";

// Bucket name from environment
const BUCKET_NAME =
  process.env.S3_STATUS_BUCKET_NAME || "supercheck-status-artifacts";

// Interface for S3 error objects
interface S3Error extends Error {
  Code?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Join the path segments to get the S3 key
    const { path } = await params;
    const s3Key = path.join("/");

    if (!s3Key) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    // Determine if this is a favicon asset (needs cache-busting)
    const isFavicon = s3Key.includes("/favicon/");

    // Use the shared S3 proxy utility with appropriate cache control
    const response = await fetchFromS3(BUCKET_NAME, s3Key, {
      cacheControl: isFavicon
        ? "public, max-age=0, must-revalidate" // No cache for favicons - they change frequently
        : undefined, // Use default 1-year cache for other assets
    });

    // Convert Response to NextResponse
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: response.status,
      headers,
    });
  } catch (error: unknown) {
    console.error("[ASSETS PROXY] Error fetching asset:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Handle HEAD requests for checking existence
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const s3Key = path.join("/");

    if (!s3Key) {
      return new NextResponse(null, { status: 400 });
    }

    // Use the shared S3 proxy utility with a minimal request
    const response = await fetchFromS3(BUCKET_NAME, s3Key);

    // Convert Response to NextResponse (head request)
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Don't include the body for HEAD requests
    return new NextResponse(null, {
      status: response.status,
      headers,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const s3Error = error as S3Error;
      if (error.name === "NoSuchKey" || s3Error.Code === "NoSuchKey") {
        return new NextResponse(null, { status: 404 });
      }

      if (error.name === "AccessDenied" || s3Error.Code === "AccessDenied") {
        return new NextResponse(null, { status: 403 });
      }
    }

    return new NextResponse(null, { status: 500 });
  }
}
