import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// Get S3 credentials from environment variables
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "minioadmin";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "minioadmin";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";

// Interface for S3 error objects
interface S3Error extends Error {
  Code?: string;
}

// Initialize S3 client
const s3Client = new S3Client({
  region: AWS_REGION,
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

// Helper function to handle various stream types from S3
async function streamToUint8Array(
  stream:
    | ReadableStream
    | NodeJS.ReadableStream
    | ArrayBuffer
    | ArrayBufferView
    | Blob
    | unknown
): Promise<Uint8Array> {
  if (!stream) {
    throw new Error("Stream is undefined or null");
  }

  // For AWS SDK v3 response bodies (Blob with stream methods)
  const awsStream = stream as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (awsStream.transformToByteArray) {
    // Use AWS SDK's built-in transformation
    const bytes = await awsStream.transformToByteArray();
    return new Uint8Array(bytes);
  }

  // For Web API ReadableStream
  if (stream && typeof (stream as ReadableStream).getReader === "function") {
    const reader = (stream as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    // Calculate total length
    const totalLength = chunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0
    );

    // Merge chunks into a single Uint8Array
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  }

  // For Node.js-like streams that have a .on() method
  if (stream && typeof (stream as NodeJS.ReadableStream).on === "function") {
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];

      (stream as NodeJS.ReadableStream).on(
        "data",
        (chunk: Uint8Array | ArrayBuffer) => {
          // Convert anything to Uint8Array
          const typedChunk =
            chunk instanceof Uint8Array
              ? chunk
              : new Uint8Array(
                  chunk instanceof ArrayBuffer
                    ? chunk
                    : new Uint8Array(chunk).buffer
                );
          chunks.push(typedChunk);
        }
      );

      (stream as NodeJS.ReadableStream).on("end", () => {
        // Calculate total size
        const totalSize = chunks.reduce(
          (sum, chunk) => sum + chunk.byteLength,
          0
        );

        // Create a new array and copy all chunks into it
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }

        resolve(result);
      });

      (stream as NodeJS.ReadableStream).on("error", reject);
    });
  }

  // If the stream is already an ArrayBuffer
  if (stream instanceof ArrayBuffer) {
    return new Uint8Array(stream);
  }

  // If the stream is an ArrayBuffer view (like Uint8Array)
  if (ArrayBuffer.isView(stream)) {
    return new Uint8Array(stream.buffer);
  }

  throw new Error("Unsupported stream type");
}

/**
 * Fetch an object from S3/MinIO and return it as a NextResponse
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @param options - Additional options
 * @returns NextResponse with the object content
 */
export async function fetchFromS3(
  bucket: string,
  key: string,
  options: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  } = {}
): Promise<Response> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const s3Response = await s3Client.send(command);

    if (!s3Response.Body) {
      throw new Error("Empty response from S3");
    }

    const buffer = await streamToUint8Array(s3Response.Body);

    const headers: Record<string, string> = {
      "Content-Type":
        options.contentType ||
        s3Response.ContentType ||
        "application/octet-stream",
      "Cache-Control": options.cacheControl || "public, max-age=31536000", // 1 year default
    };

    if (s3Response.ContentLength) {
      headers["Content-Length"] = s3Response.ContentLength.toString();
    }

    if (s3Response.ETag) {
      headers["ETag"] = s3Response.ETag;
    }

    if (s3Response.LastModified) {
      headers["Last-Modified"] = s3Response.LastModified.toUTCString();
    }

    if (options.contentDisposition) {
      headers["Content-Disposition"] = options.contentDisposition;
    }

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    console.error(`[S3 PROXY] Error fetching ${bucket}/${key}:`, error);

    // Handle specific S3 errors
    if (error instanceof Error) {
      const s3Error = error as S3Error;
      if (error.name === "NoSuchKey" || s3Error.Code === "NoSuchKey") {
        return new Response(JSON.stringify({ error: "Object not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (error.name === "AccessDenied" || s3Error.Code === "AccessDenied") {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Check if an object exists in S3/MinIO
 * @param bucket - S3 bucket name
 * @param key - S3 object key
 * @returns True if object exists
 */
export async function checkObjectExists(
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    return !!response.Body;
  } catch (error: unknown) {
    if (error instanceof Error) {
      const s3Error = error as S3Error;
      if (error.name === "NoSuchKey" || s3Error.Code === "NoSuchKey") {
        return false;
      }
    }
    throw error;
  }
}

/**
 * Get the S3 client instance
 * @returns S3Client instance
 */
export function getS3Client(): S3Client {
  return s3Client;
}
