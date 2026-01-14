import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/utils/db";
import { apikey } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { generateApiKey, hashApiKey, getApiKeyPrefix } from "@/lib/security/api-key-hash";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "extension-auth" });

const authRequestSchema = z.object({
  name: z.string().optional().default("SuperCheck Recorder Extension"),
  extensionVersion: z.string().optional(),
});

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
    const session = await auth.api.getSession({
      headers: await headers(),
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

    // Check if user already has an extension API key
    const existingKeys = await db
      .select()
      .from(apikey)
      .where(eq(apikey.userId, userId));

    const existingExtensionKey = existingKeys.find(
      (k) => k.name?.includes("Recorder") || k.name?.includes("Extension")
    );

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

    // Generate new API key
    const rawApiKey = generateApiKey();
    const hashedKey = hashApiKey(rawApiKey);
    const apiKeyStart = getApiKeyPrefix(rawApiKey);
    const now = new Date();

    // Create API key record
    const [newKey] = await db
      .insert(apikey)
      .values({
        userId,
        name: data.name,
        start: apiKeyStart,
        prefix: "ext",
        key: hashedKey,
        enabled: true,
        expiresAt: null, // Extension keys don't expire by default
        createdAt: now,
        updatedAt: now,
        permissions: ["recorder:save"],
      })
      .returning();

    logger.info(
      { userId, keyId: newKey.id, extensionVersion: data.extensionVersion },
      "Extension API key generated"
    );

    return NextResponse.json({
      success: true,
      data: {
        apiKey: rawApiKey, // Only returned once, user must save it
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

    return NextResponse.json(
      { success: false, error: "Failed to generate API key" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/extension/auth
 * Revoke the extension API key
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Find and disable extension API keys
    const existingKeys = await db
      .select()
      .from(apikey)
      .where(eq(apikey.userId, userId));

    const extensionKeys = existingKeys.filter(
      (k) => k.name?.includes("Recorder") || k.name?.includes("Extension")
    );

    for (const key of extensionKeys) {
      await db
        .update(apikey)
        .set({ enabled: false })
        .where(eq(apikey.id, key.id));
    }

    logger.info({ userId, keysRevoked: extensionKeys.length }, "Extension API keys revoked");

    return NextResponse.json({
      success: true,
      data: { keysRevoked: extensionKeys.length },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to revoke extension API key");

    return NextResponse.json(
      { success: false, error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
