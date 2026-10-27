import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";
import { member, user } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { isUuid } from "@/lib/uuid";
import { AVATAR_CONTENT_TYPES, avatarVersionOf, getAvatar, type AvatarExt } from "@/lib/user-avatar";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  // Visible to the owner and to people who share an organization with them.
  if (viewer.id !== id) {
    const theirs = alias(member, "their_member");
    const [shared] = await db
      .select({ id: member.id })
      .from(member)
      .innerJoin(theirs, eq(theirs.organizationId, member.organizationId))
      .where(and(eq(member.userId, viewer.id), eq(theirs.userId, id)))
      .limit(1);
    if (!shared) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The object key comes from the stored profile, never from the request.
  const [row] = await db.select({ image: user.image }).from(user).where(eq(user.id, id)).limit(1);
  const version = avatarVersionOf(id, row?.image);
  if (!version) return notFound();

  const body = await getAvatar(id, version);
  if (!body) return notFound();

  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": AVATAR_CONTENT_TYPES[version.split(".")[1] as AvatarExt],
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      // Versioned URL, but access can be revoked (leaving an org), so keep it short and private.
      "Cache-Control": "private, max-age=3600",
      Vary: "Cookie",
    },
  });
}
