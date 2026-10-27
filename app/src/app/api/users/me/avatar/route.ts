import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { db } from "@/utils/db";
import { user } from "@/db/schema";
import { checkAdminRateLimit } from "@/lib/session-security";
import {
  AVATAR_MAX_BYTES, avatarPath, avatarVersionOf, deleteAvatar, detectAvatarType, newAvatarVersion, putAvatar,
} from "@/lib/user-avatar";

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

async function setImage(image: string | null) {
  await auth.api.updateUser({ headers: await headers(), body: { image } });
}

export async function POST(request: NextRequest) {
  const s = await currentSession();
  if (s.error) return s.error;

  const limit = await checkAdminRateLimit(s.userId, "avatar-upload", 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    const retry = Math.max(1, Math.ceil(((limit.resetTime ?? Date.now()) - Date.now()) / 1000));
    return err("Too many uploads. Try again later.", 429, { "Retry-After": String(retry) });
  }

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
  return NextResponse.json({ image: avatarPath(s.userId, version) });
}

export async function DELETE() {
  const s = await currentSession();
  if (s.error) return s.error;
  const previous = await previousVersion(s.userId);
  try {
    await setImage(null);
  } catch (error) {
    console.error("[AVATAR] Remove failed:", error);
    return err("Failed to remove image", 500);
  }
  if (previous) await deleteAvatar(s.userId, previous);
  return NextResponse.json({ image: null });
}
