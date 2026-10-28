import { NextRequest, NextResponse } from "next/server";
import type { InferAPI } from "better-auth";
import type { apiKey } from "@better-auth/api-key";
import { defaultKeyHasher } from "@better-auth/api-key";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { z } from "zod";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { createLogger } from "@/lib/logger/pino-config";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext, isImpersonatedSession } from "@/lib/rbac/middleware";

const logger = createLogger({ module: "extension-auth" });

const EXTENSION_API_KEY_CONFIG_ID = "default";
const EXTENSION_API_KEY_PREFIX = "ext";
const EXTENSION_API_KEY_MAX_NAME_LENGTH = 32;
const DEFAULT_EXTENSION_API_KEY_NAME = "Supercheck Recorder Extension";
const EXTENSION_API_KEY_NAME_PREFIX = "Recorder: ";
const EXTENSION_API_KEY_PERMISSIONS: Record<string, string[]> = {
  recorder: ["save"],
};
const EXTENSION_PERMISSION_STATEMENT = "recorder:save";

// Each browser holds its own key, so reinstalls and extra devices leave older ones
// behind. Minting beyond this cap disables the oldest.
const MAX_ENABLED_EXTENSION_KEYS = 5;

const authRequestSchema = z.object({
  name: z.string().optional().default("Supercheck Recorder Extension"),
  extensionVersion: z.string().optional(),
  // undefined: older extension that does not report its key; null: it holds none;
  // string: the key id it holds.
  clientKeyId: z.string().nullable().optional(),
});

type ApiKeyServerApi = Pick<
  InferAPI<ReturnType<typeof apiKey>["endpoints"]>,
  "createApiKey" | "updateApiKey"
>;

const apiKeyServerApi = auth.api as typeof auth.api & ApiKeyServerApi;

function normalizeExtensionKeyName(name: string | undefined) {
  const trimmed = name?.trim() || DEFAULT_EXTENSION_API_KEY_NAME;
  return `${EXTENSION_API_KEY_NAME_PREFIX}${trimmed}`.slice(0, EXTENSION_API_KEY_MAX_NAME_LENGTH);
}

function getPermissionStatements(rawPermissions: unknown): string[] {
  if (!rawPermissions) {
    return [];
  }

  let parsedPermissions = rawPermissions;
  if (typeof parsedPermissions === "string") {
    try {
      parsedPermissions = JSON.parse(parsedPermissions);
    } catch {
      return [String(parsedPermissions)];
    }
  }

  if (Array.isArray(parsedPermissions)) {
    return parsedPermissions.filter(
      (permission): permission is string => typeof permission === "string"
    );
  }

  if (typeof parsedPermissions !== "object") {
    return [];
  }

  return Object.entries(parsedPermissions).flatMap(([resource, actions]) => {
    if (!Array.isArray(actions)) {
      return [];
    }

    return actions
      .filter((action): action is string => typeof action === "string")
      .map((action) => `${resource}:${action}`);
  });
}

function isExtensionKey(key: {
  name: string | null;
  prefix: string | null;
  permissions: unknown;
}): boolean {
  return (
    key.name?.startsWith(EXTENSION_API_KEY_NAME_PREFIX) === true ||
    key.prefix === EXTENSION_API_KEY_PREFIX ||
    getPermissionStatements(key.permissions).includes(
      EXTENSION_PERMISSION_STATEMENT
    )
  );
}

// Read without Better Auth’s list cap; classify permission-only keys in the caller.
type Executor = Pick<typeof db, "select">;

async function findEnabledExtensionKeys(executor: Executor, userId: string) {
  return executor
    .select({
      id: apikey.id,
      name: apikey.name,
      prefix: apikey.prefix,
      permissions: apikey.permissions,
    })
    .from(apikey)
    .where(
      and(
        eq(apikey.referenceId, userId),
        eq(apikey.configId, EXTENSION_API_KEY_CONFIG_ID),
        eq(apikey.enabled, true)
      )
    )
    .orderBy(apikey.createdAt);
}

function getBetterAuthErrorStatus(error: unknown) {
  const candidate = error as { statusCode?: unknown; status?: unknown } | null;

  if (typeof candidate?.statusCode === "number" && candidate.statusCode >= 400 && candidate.statusCode < 600) {
    return candidate.statusCode;
  }

  switch (candidate?.status) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    default:
      return 500;
  }
}

function getBetterAuthErrorMessage(error: unknown) {
  const candidate = error as { body?: { message?: unknown }; message?: unknown } | null;
  const message = typeof candidate?.body?.message === "string"
    ? candidate.body.message
    : typeof candidate?.message === "string"
      ? candidate.message
      : null;

  return message || "Failed to generate API key";
}

/**
 * POST /api/extension/auth
 * Generate an API key for the Supercheck Recorder extension
 * 
 * Authentication: Session cookie (user must be logged in)
 * Used by: Supercheck web app to connect the extension
 */
export async function POST(request: NextRequest) {
  try {
    // Get session from Better Auth
    const requestHeaders = await headers();
    const session = await auth.api.getSession({
      headers: requestHeaders,
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const authContext = await requireAuthContext();
    if (!checkPermissionWithContext("apiKey", "create", authContext)) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    // A recorder key minted while impersonating would belong to the impersonated user and never expire.
    if (await isImpersonatedSession()) {
      return NextResponse.json(
        { success: false, error: "Recorder keys cannot be created while impersonating a user" },
        { status: 403 }
      );
    }

    const userId = session.user.id;

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const validation = authRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request" },
        { status: 400 }
      );
    }

    const data = validation.data;
    const apiKeyName = normalizeExtensionKeyName(data.name);

    // One transaction per user: the advisory lock makes check-then-mint atomic
    // across tabs and instances, so concurrent connects cannot each mint a key.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

      // listApiKeys cannot be used here: its adapter caps unpaginated reads, so
      // the newest key is invisible past 100 API keys.
      const existingKeys = (await findEnabledExtensionKeys(tx, userId)).filter(
        isExtensionKey
      );
      const heldKey = data.clientKeyId === undefined
        ? existingKeys[0]
        : existingKeys.find((key) => key.id === data.clientKeyId);

      if (heldKey) {
        // The raw key is only returned at creation, never again.
        return { keyId: heldKey.id, apiKey: undefined };
      }

      // The extension holds no usable key (reinstall, new profile, lost response):
      // mint a new one and retire the oldest beyond the cap.
      const stale = existingKeys.slice(
        0,
        Math.max(0, existingKeys.length - (MAX_ENABLED_EXTENSION_KEYS - 1))
      );
      if (stale.length > 0) {
        await tx
          .update(apikey)
          .set({ enabled: false })
          .where(inArray(apikey.id, stale.map((key) => key.id)));
      }
      const newKey = await apiKeyServerApi.createApiKey({
        // Do not pass request headers: Better Auth treats permissions as a
        // server-only property whenever headers/request context are present.
        body: {
          userId,
          configId: EXTENSION_API_KEY_CONFIG_ID,
          name: apiKeyName,
          prefix: EXTENSION_API_KEY_PREFIX,
          permissions: EXTENSION_API_KEY_PERMISSIONS,
        },
      });
      return { keyId: newKey.id, apiKey: newKey.key };
    });

    const user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };

    if (!result.apiKey) {
      return NextResponse.json({
        success: true,
        data: { message: "Extension already connected", keyId: result.keyId, user },
      });
    }

    logger.info(
      { userId, keyId: result.keyId, extensionVersion: data.extensionVersion },
      "Extension API key generated"
    );

    return NextResponse.json({
      success: true,
      data: { apiKey: result.apiKey, keyId: result.keyId, user }, // apiKey is only returned once
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to generate extension API key");
    const status = getBetterAuthErrorStatus(error);

    return NextResponse.json(
      { success: false, error: status >= 500 ? "Failed to generate API key" : getBetterAuthErrorMessage(error) },
      { status }
    );
  }
}

/**
 * DELETE /api/extension/auth
 * Revoke the extension API key
 */
export async function DELETE(request: NextRequest) {
  try {
    const rawKey = request.headers.get("x-api-key")?.trim();
    if (rawKey) {
      const keyHashes = [hashApiKey(rawKey), await defaultKeyHasher(rawKey)];
      // A recorder may revoke only the extension credential it possesses.
      const revoked = await db.update(apikey).set({ enabled: false }).where(and(
        eq(apikey.prefix, EXTENSION_API_KEY_PREFIX),
        or(...keyHashes.map((keyHash) => eq(apikey.key, keyHash))),
      )).returning({ id: apikey.id });
      return NextResponse.json({ success: true, data: { keysRevoked: revoked.length } });
    }
    const requestHeaders = await headers();
    const session = await auth.api.getSession({
      headers: requestHeaders,
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const extensionKeys = (await findEnabledExtensionKeys(db, userId)).filter(
      isExtensionKey
    );
    let revokedCount = 0;

    for (const key of extensionKeys) {
      await apiKeyServerApi.updateApiKey({
        headers: requestHeaders,
        body: {
          configId: EXTENSION_API_KEY_CONFIG_ID,
          keyId: key.id,
          enabled: false,
        },
      });

      revokedCount += 1;
    }

    logger.info({ userId, keysRevoked: revokedCount }, "Extension API keys revoked");

    return NextResponse.json({
      success: true,
      data: { keysRevoked: revokedCount },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to revoke extension API key");

    return NextResponse.json(
      { success: false, error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
