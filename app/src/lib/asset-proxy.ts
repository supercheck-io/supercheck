/**
 * Asset proxy utility functions
 *
 * Instead of using presigned URLs, we proxy S3/MinIO assets through Next.js API routes.
 * This approach works consistently across all S3-compatible storage providers.
 */

// Default bucket name - must match the default in upload route and assets API
const DEFAULT_STATUS_BUCKET_NAME = "status-page-artifacts";

/**
 * Get the status bucket name from environment or use default
 */
function getStatusBucketName(): string {
  return process.env.S3_STATUS_BUCKET_NAME || DEFAULT_STATUS_BUCKET_NAME;
}

/**
 * Generate a proxy URL for an S3 asset
 * @param s3Reference - S3 reference in format: bucket/key
 * @returns Proxy URL or null if invalid reference
 */
export function generateProxyUrl(
  s3Reference: string | null | undefined
): string | null {
  if (!s3Reference) {
    return null;
  }

  try {
    // Parse S3 reference format: bucket/key
    const parts = s3Reference.split("/");
    if (parts.length < 2) {
      console.error(
        `[ASSET PROXY] Invalid S3 reference format: ${s3Reference}`
      );
      return null;
    }

    const bucket = parts[0];
    const key = parts.slice(1).join("/");

    // Proxy the status bucket through our API route
    const statusBucketName = getStatusBucketName();
    if (bucket === statusBucketName) {
      return `/api/assets/${key}`;
    }

    // For unsupported buckets, return the original reference as fallback
    // This allows the UI to attempt direct access or show a placeholder
    // instead of breaking completely with null
    console.warn(`[ASSET PROXY] Bucket ${bucket} not supported for proxying, returning original reference`);
    return s3Reference;
  } catch (error) {
    console.error(
      `[ASSET PROXY] Error generating proxy URL for ${s3Reference}:`,
      error
    );
    // Return original reference as fallback instead of null
    return s3Reference;
  }
}

/**
 * Generate proxy URLs for multiple S3 references
 * @param references - Array of S3 references
 * @returns Array of proxy URLs (null for invalid references)
 */
export function generateProxyUrls(
  references: (string | null | undefined)[]
): (string | null)[] {
  return references.map((ref) => generateProxyUrl(ref));
}

/**
 * Check if a bucket is supported for proxying
 * @param bucket - Bucket name
 * @returns True if bucket is supported for proxying
 */
export function isBucketSupported(bucket: string): boolean {
  return bucket === getStatusBucketName();
}
