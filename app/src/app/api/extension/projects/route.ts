import { defaultKeyHasher } from "@better-auth/api-key";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { apikey, member } from "@/db/schema";
import { getUserProjects } from "@/lib/session";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { db } from "@/utils/db";

/**
 * Lists projects for the recorder without granting an extension key the
 * session-equivalent access provided by the general application auth context.
 */
export async function GET(request: NextRequest) {
  const rawKey = request.headers.get("x-api-key")?.trim();
  if (!rawKey) {
    return NextResponse.json(
      { success: false, error: "API key required" },
      { status: 401 },
    );
  }

  const legacyHash = hashApiKey(rawKey);
  const pluginHash = await defaultKeyHasher(rawKey);
  const hashConditions = Array.from(new Set([legacyHash, pluginHash])).map(
    (keyHash) => eq(apikey.key, keyHash),
  );

  const [extensionKey] = await db
    .select({ id: apikey.id, userId: apikey.referenceId })
    .from(apikey)
    .where(
      and(
        eq(apikey.enabled, true),
        eq(apikey.prefix, "ext"),
        or(isNull(apikey.expiresAt), gt(apikey.expiresAt, new Date())),
        hashConditions.length === 1
          ? hashConditions[0]
          : or(...hashConditions),
      ),
    )
    .limit(1);

  if (!extensionKey?.userId) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired extension key" },
      { status: 401 },
    );
  }

  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, extensionKey.userId));

  const projectGroups = await Promise.all(
    memberships.map(({ organizationId }) =>
      getUserProjects(extensionKey.userId, organizationId),
    ),
  );

  await db
    .update(apikey)
    .set({ lastRequest: new Date() })
    .where(eq(apikey.id, extensionKey.id));

  return NextResponse.json({
    success: true,
    data: projectGroups.flat(),
    currentProject: null,
  });
}
