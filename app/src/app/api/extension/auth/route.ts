import { NextRequest, NextResponse } from "next/server";
import type { InferAPI } from "better-auth";
import type { apiKey } from "@better-auth/api-key";
import { z } from "zod";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "extension-auth" });

const EXTENSION_API_KEY_CONFIG_ID = "default";
const EXTENSION_API_KEY_PREFIX = "ext";
const EXTENSION_API_KEY_LIST_LIMIT = 1000;
const EXTENSION_API_KEY_MAX_NAME_LENGTH = 32;
const DEFAULT_EXTENSION_API_KEY_NAME = "SuperCheck Recorder Extension";
const EXTENSION_API_KEY_PERMISSIONS: Record<string, string[]> = {
  recorder: ["save"],
};
const EXTENSION_PERMISSION_STATEMENT = "recorder:save";

const authRequestSchema = z.object({
  name: z.string().optional().default("SuperCheck Recorder Extension"),
  extensionVersion: z.string().optional(),
});

type ApiKeyServerApi = Pick<
  InferAPI<ReturnType<typeof apiKey>["endpoints"]>,
  "createApiKey" | "listApiKeys" | "updateApiKey"
>;
type ListedApiKey = Awaited<
  ReturnType<ApiKeyServerApi["listApiKeys"]>
>["apiKeys"][number];

const apiKeyServerApi = auth.api as typeof auth.api & ApiKeyServerApi;

function normalizeExtensionKeyName(name: string | undefined) {
  const trimmed = name?.trim() || DEFAULT_EXTENSION_API_KEY_NAME;
  return trimmed.slice(0, EXTENSION_API_KEY_MAX_NAME_LENGTH);
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

function isExtensionKey(
  apiKey: Pick<ListedApiKey, "permissions" | "prefix">
): boolean {
  return (
    apiKey.prefix === EXTENSION_API_KEY_PREFIX ||
    getPermissionStatements(apiKey.permissions).includes(
      EXTENSION_PERMISSION_STATEMENT
    )
  );
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
 * Generate an API key for the SuperCheck Recorder extension
 * 
 * Authentication: Session cookie (user must be logged in)
 * Used by: SuperCheck web app to connect the extension
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

    const { apiKeys } = await apiKeyServerApi.listApiKeys({
      headers: requestHeaders,
      query: {
        configId: EXTENSION_API_KEY_CONFIG_ID,
        limit: EXTENSION_API_KEY_LIST_LIMIT,
      },
    });

    const existingExtensionKey = apiKeys.find(isExtensionKey);

    if (existingExtensionKey && existingExtensionKey.enabled) {
      // Return existing key info (but not the key itself for security)
      return NextResponse.json({
        success: true,
        data: {
          message: "Extension already connected",
          keyId: existingExtensionKey.id,
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
          },
        },
      });
    }

    // Create a new extension-scoped key using Better Auth's supported API key flow.
    // Do not pass request headers here: Better Auth treats permissions as a
    // server-only property whenever headers/request context are present. The
    // route already authenticated the session above, so binding the key to that
    // user ID is the intended server-side flow.
    const newKey = await apiKeyServerApi.createApiKey({
      body: {
        userId,
        configId: EXTENSION_API_KEY_CONFIG_ID,
        name: apiKeyName,
        prefix: EXTENSION_API_KEY_PREFIX,
        permissions: EXTENSION_API_KEY_PERMISSIONS,
      },
    });

    logger.info(
      { userId, keyId: newKey.id, extensionVersion: data.extensionVersion },
      "Extension API key generated"
    );

    return NextResponse.json({
      success: true,
      data: {
        apiKey: newKey.key, // Only returned once, user must save it
        keyId: newKey.id,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        },
      },
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

    const { apiKeys } = await apiKeyServerApi.listApiKeys({
      headers: requestHeaders,
      query: {
        configId: EXTENSION_API_KEY_CONFIG_ID,
        limit: EXTENSION_API_KEY_LIST_LIMIT,
      },
    });
    const extensionKeys = apiKeys.filter(isExtensionKey);

    let revokedCount = 0;

    for (const key of extensionKeys) {
      if (!key.enabled) {
        continue;
      }

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
