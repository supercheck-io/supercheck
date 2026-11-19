import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  notificationProviders,
  notificationProvidersInsertSchema,
  type PlainNotificationProviderConfig,
} from "@/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError, authErrorResponse } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  decryptNotificationProviderConfig,
  encryptNotificationProviderConfig,
  sanitizeConfigForClient,
} from "@/lib/notification-providers/crypto";
import {
  normalizeProviderConfig,
  validateProviderConfig,
} from "@/lib/notification-providers/validation";
import type { NotificationProviderType } from "@/db/schema";
import { loadCreators } from "@/lib/creators";
import { loadProviderHealth } from "@/lib/notification-providers/channel-health";
import { loadChannelUsage } from "@/lib/notification-providers/channel-usage";

import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { requireSessionSameOrigin } from "@/lib/security/same-origin";
import { readJsonBody } from "@/lib/http/read-capped-json";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROVIDER_NAME_LENGTH = 255;
const MAX_PROVIDER_CONFIG_LENGTH = 20_000;

export async function GET() {
  try {
    const context = await requireAuthContext();

    // Use current project and organization context
    const targetProjectId = context.project.id;
    const targetOrganizationId = context.organizationId;

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext("notification", "view", context);

    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const canEdit = checkPermissionWithContext("notification", "update", context);

    // Get notification providers scoped to the project
    // Using ID ordering instead of createdAt since UUIDv7 is time-ordered (PostgreSQL 18+)
    const providers = await db
      .select()
      .from(notificationProviders)
      .where(
        and(
          eq(notificationProviders.organizationId, targetOrganizationId),
          eq(notificationProviders.projectId, targetProjectId)
        )
      )
      .orderBy(desc(notificationProviders.id));

    if (providers.length === 0) {
      return NextResponse.json([]);
    }

    const creatorOf = await loadCreators(providers.map((p) => p.createdByUserId));

    const { health: healthMap, lastUsed: lastAlertMap, lastTest } = await loadProviderHealth(providers.map((p) => p.id));
    const usage = await loadChannelUsage(targetProjectId, providers.map((p) => p.id));

    // Enhance providers with last used information (no N+1 queries)
    const enhancedProviders = providers.map((provider) => {
      const configContext = provider.projectId ?? undefined;
      let sanitizedConfig: PlainNotificationProviderConfig = {};
      let maskedFields: string[] = [];
      let configUnavailable = false;
      try {
        const decryptedConfig = decryptNotificationProviderConfig(provider.config, configContext);
        ({ sanitizedConfig, maskedFields } = sanitizeConfigForClient(
          provider.type as NotificationProviderType,
          decryptedConfig,
          { canEdit },
        ));
      } catch {
        // Keep one stale/corrupt credential from hiding every provider, but do
        // not represent an undecryptable value as valid configuration.
        configUnavailable = true;
      }

      return {
        ...provider,
        ...creatorOf(provider.createdByUserId),
        config: sanitizedConfig,
        maskedFields,
        configUnavailable,
        lastUsed: lastAlertMap.get(provider.id) || null,
        health: healthMap.get(provider.id) ?? { state: "unknown" as const, at: null },
        lastTest: lastTest.get(provider.id) ?? null,
        usage: usage.get(provider.id) ?? { monitors: 0, jobs: 0, policy: false },
      };
    });

    return NextResponse.json(enhancedProviders);
  } catch (error) {
    if (isAuthError(error)) {
      return authErrorResponse(error);
    }
    console.error("Error fetching notification providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification providers" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireAuthContext();
    const originError = requireSessionSameOrigin(req, context.isCliAuth);
    if (originError) return originError;
    const { userId, project, organizationId } = context;

    let rawData;
    const read = await readJsonBody(req, MAX_BODY_BYTES);
    if (read instanceof NextResponse) return read;
    rawData = read.body;

    // Use current project and organization context
    const targetProjectId = project.id;
    const targetOrganizationId = organizationId;

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canCreate = checkPermissionWithContext("notification", "create", context);

    if (!canCreate) {
      return await permissionDeniedResponse(organizationId, "Insufficient permissions to create notification providers");
    }

    // Transform the data to match the database schema
    // The frontend sends { type, config } but the database expects { name, type, config, organizationId, projectId, createdByUserId }
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    // The top-level name is the documented one; config.name is the web form's fallback.
    const providedName = [rawData.name, rawData.config?.name].find(
      (n) => typeof n === "string" && n.trim()
    ) ?? rawData.name ?? rawData.config?.name;
    if (typeof providedName !== "string" || !providedName.trim()) {
      return NextResponse.json({ error: "Provider name is required" }, { status: 400 });
    }
    if ([...providedName].length > MAX_PROVIDER_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Provider name must be at most ${MAX_PROVIDER_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (JSON.stringify(rawData.config ?? {}).length > MAX_PROVIDER_CONFIG_LENGTH) {
      return NextResponse.json(
        { error: `Provider config must be at most ${MAX_PROVIDER_CONFIG_LENGTH} characters` },
        { status: 400 }
      );
    }

    const transformedData = {
      name: providedName.trim(),
      type: rawData.type,
      config: rawData.config,
      isEnabled: rawData.isEnabled,
      organizationId: targetOrganizationId,
      projectId: targetProjectId,
      createdByUserId: userId,
    };

    const validationResult =
      notificationProvidersInsertSchema.safeParse(transformedData);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const newProviderData = validationResult.data;

    const plainConfig = (newProviderData.config ?? {}) as Record<
      string,
      unknown
    >;

    try {
      validateProviderConfig(
        newProviderData.type as NotificationProviderType,
        plainConfig
      );
    } catch (validationError) {
      return NextResponse.json(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid notification provider configuration",
        },
        { status: 400 }
      );
    }

    const normalizedConfig = normalizeProviderConfig(
      newProviderData.type as NotificationProviderType,
      plainConfig,
    );

    const encryptedConfig = encryptNotificationProviderConfig(
      normalizedConfig as PlainNotificationProviderConfig,
      targetProjectId
    );

    const [insertedProvider] = await db
      .insert(notificationProviders)
      .values({
        name: newProviderData.name!,
        type: newProviderData.type as NotificationProviderType,
        config: encryptedConfig,
        isEnabled: newProviderData.isEnabled ?? true,
        organizationId: newProviderData.organizationId,
        projectId: newProviderData.projectId,
        createdByUserId: newProviderData.createdByUserId,
      })
      .returning();

    // Log the audit event for notification provider creation
    await logAuditEvent({
      userId,
      organizationId,
      action: "notification_provider_created",
      resource: "notification_provider",
      resourceId: insertedProvider.id,
      metadata: {
        providerName: insertedProvider.name,
        providerType: insertedProvider.type,
        projectId: project.id,
        projectName: project.name,
      },
      success: true,
    });

    const decryptedConfig = decryptNotificationProviderConfig(
      insertedProvider.config,
      targetProjectId
    );
    const { sanitizedConfig, maskedFields } = sanitizeConfigForClient(
      insertedProvider.type as NotificationProviderType,
      decryptedConfig,
      { canEdit: checkPermissionWithContext("notification", "update", context) }
    );

    return NextResponse.json(
      {
        ...insertedProvider,
        config: sanitizedConfig,
        maskedFields,
      },
      { status: 201 }
    );
  } catch (error) {
    if (isAuthError(error)) {
      return authErrorResponse(error);
    }
    console.error("Error creating notification provider:", error);
    return NextResponse.json(
      { error: "Failed to create notification provider" },
      { status: 500 }
    );
  }
}
