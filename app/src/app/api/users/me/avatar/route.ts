import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { db } from "@/utils/db";
import { user } from "@/db/schema";
import { checkAdminRateLimit } from "@/lib/session-security";
import {
  AVATAR_MAX_BYTES, avatarPath, avatarVersionOf, deleteAvatar, detectAvatarType, newAvatarVersion, pruneAvatars, putAvatar,
} from "@/lib/user-avatar";
import { isAvatarPreset } from "@/lib/avatar-presets";

const err = (error: string, status: number, extra?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers: extra });

async function currentSession(): Promise<{ userId: string; error?: undefined } | { error: NextResponse; userId?: undefined }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { error: err("Authentication required", 401) };
  // An admin impersonating a user must not change that user's profile.
  if (session.session.impersonatedBy) return { error: err("Not allowed while impersonating", 403) };
  return { userId: session.user.id };
}

async function previousVersion(userId: string) {
  const [row] = await db.select({ image: user.image }).from(user).where(eq(user.id, userId)).limit(1);
  return avatarVersionOf(userId, row?.image);
}

async function rateLimited(userId: string, key: string, message: string) {
  const limit = await checkAdminRateLimit(userId, key, 10, 10 * 60 * 1000);
  if (limit.allowed) return null;
  const retry = Math.max(1, Math.ceil(((limit.resetTime ?? Date.now()) - Date.now()) / 1000));
  return err(message, 429, { "Retry-After": String(retry) });
}

async function setImage(image: string | null) {
  await auth.api.updateUser({ headers: await headers(), body: { image } });
}

export async function POST(request: NextRequest) {
  const s = await currentSession();
  if (s.error) return s.error;
  const limited = await rateLimited(s.userId, "avatar-upload", "Too many uploads. Try again later.");
  if (limited) return limited;

  // Reject oversized bodies before buffering them (multipart overhead is small).
  const lengthHeader = request.headers.get("content-length");
  if (!lengthHeader) return err("Content-Length required", 411);
  if (!(Number(lengthHeader) <= AVATAR_MAX_BYTES + 16 * 1024)) return err("Image must be 2 MB or smaller", 413);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return err("No file provided", 400);
  if (file.size > AVATAR_MAX_BYTES) return err("Image must be 2 MB or smaller", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = detectAvatarType(bytes);
  if (!ext) return err("Only PNG, JPEG or WebP images are allowed", 415);

  const previous = await previousVersion(s.userId);
  const version = newAvatarVersion(ext);
  try {
    await putAvatar(s.userId, version, bytes);
    await setImage(avatarPath(s.userId, version));
  } catch (error) {
    console.error("[AVATAR] Upload failed:", error);
    await deleteAvatar(s.userId, version);
    return err("Failed to upload image", 500);
  }
  if (previous) await deleteAvatar(s.userId, previous);
  await pruneAvatars(s.userId, version);
  return NextResponse.json({ image: avatarPath(s.userId, version) });
}

/** Point user.image at a preset (or nothing) and delete the uploaded object it replaces. */
async function replaceUpload(userId: string, image: string | null) {
  const previous = await previousVersion(userId);
  try {
    await setImage(image);
  } catch (error) {
    console.error("[AVATAR] Update failed:", error);
    return err(image ? "Failed to update image" : "Failed to remove image", 500);
  }
  if (previous) await deleteAvatar(userId, previous);
  await pruneAvatars(userId, null);
  return NextResponse.json({ image });
}

/** Choose a preset avatar: `{ "preset": "/avatars/notionists-01.svg" }`. */
export async function PUT(request: NextRequest) {
  const s = await currentSession();
  if (s.error) return s.error;
  const limited = await rateLimited(s.userId, "avatar-preset", "Too many changes. Try again later.");
  if (limited) return limited;
  const preset = ((await request.json().catch(() => null)) as { preset?: unknown } | null)?.preset;
  if (!isAvatarPreset(preset)) return err("Unknown avatar", 400);
  return replaceUpload(s.userId, preset);
}

export async function DELETE() {
  const s = await currentSession();
  if (s.error) return s.error;
  return replaceUpload(s.userId, null);
}
