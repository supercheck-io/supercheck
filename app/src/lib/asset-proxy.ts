/**
 * Asset proxy utility functions
 *
 * Instead of using presigned URLs, we proxy S3/MinIO assets through Next.js API routes.
 * This approach works consistently across all S3-compatible storage providers.
 */

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

    // For now, we only proxy the status bucket
    // In the future, we could extend this to other buckets
    if (bucket === process.env.S3_STATUS_BUCKET_NAME) {
      return `/api/assets/${key}`;
    }

    // For other buckets, we could create additional proxy routes
    // For now, fall back to the original presigned URL approach
    console.warn(`[ASSET PROXY] Bucket ${bucket} not supported for proxying`);
    return null;
  } catch (error) {
    console.error(
      `[ASSET PROXY] Error generating proxy URL for ${s3Reference}:`,
      error
    );
    return null;
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
  return bucket === process.env.S3_STATUS_BUCKET_NAME;
}
