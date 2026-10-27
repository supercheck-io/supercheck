import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// Reuses the status-page bucket (already provisioned in every deployment); avatars live under their own prefix.
const BUCKET = process.env.S3_STATUS_BUCKET_NAME || "status-page-artifacts";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
  forcePathStyle: true, // Required for MinIO/RustFS
});

export type AvatarExt = "png" | "jpg" | "webp";
export const AVATAR_CONTENT_TYPES: Record<AvatarExt, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** Identify the image from its magic bytes; the client-declared Content-Type is never trusted. */
export function detectAvatarType(b: Uint8Array): AvatarExt | null {
  const startsWith = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
  if (b.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (b.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return "jpg";
  if (b.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

export { avatarPath, avatarVersionOf } from "./user-avatar-path";

const keyOf = (userId: string, version: string) => `avatars/${userId}/${version}`;

export function newAvatarVersion(ext: AvatarExt): string {
  return `${randomBytes(16).toString("hex")}.${ext}`;
}

export async function putAvatar(userId: string, version: string, body: Uint8Array): Promise<void> {
  const ext = version.split(".")[1] as AvatarExt;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: keyOf(userId, version),
    Body: body,
    ContentType: AVATAR_CONTENT_TYPES[ext],
    CacheControl: "private, max-age=3600",
  }));
}

export async function deleteAvatar(userId: string, version: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keyOf(userId, version) }));
  } catch (error) {
    console.error("[AVATAR] Failed to delete previous avatar object:", error);
  }
}

// An upload that is still between putAvatar and updateUser is younger than this, so pruning never removes it.
const PRUNE_MIN_AGE_MS = 60_000;

/**
 * Deletes the user's stored avatar objects except `keep`. Covers orphans from concurrent
 * uploads (both read the same previous version) and account deletion (keep = null, minAgeMs = 0).
 * Best effort: failures are logged, never thrown.
 */
export async function pruneAvatars(userId: string, keep: string | null, minAgeMs = PRUNE_MIN_AGE_MS): Promise<void> {
  try {
    const prefix = `avatars/${userId}/`;
    const objects: { Key?: string; LastModified?: Date }[] = [];
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
      objects.push(...(page.Contents ?? []));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    const cutoff = Date.now() - minAgeMs;
    const stale = objects.filter(
      (object) => object.Key && object.Key !== `${prefix}${keep}` && (object.LastModified?.getTime() ?? 0) <= cutoff,
    );
    await Promise.all(stale.map((object) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: object.Key }))));
  } catch (error) {
    console.error("[AVATAR] Failed to prune avatar objects:", error);
  }
}

export async function getAvatar(userId: string, version: string): Promise<Uint8Array | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyOf(userId, version) }));
    return (await res.Body?.transformToByteArray()) ?? null;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}
