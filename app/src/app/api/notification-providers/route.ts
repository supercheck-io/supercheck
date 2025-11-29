import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { notificationProviders, notificationProvidersInsertSchema, alertHistory, type PlainNotificationProviderConfig } from "@/db/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';
import { logAuditEvent } from '@/lib/audit-logger';
import { decryptNotificationProviderConfig, encryptNotificationProviderConfig, sanitizeConfigForClient } from "@/lib/notification-providers/crypto";
import { validateProviderConfig } from "@/lib/notification-providers/validation";
import type { NotificationProviderType } from "@/db/schema";

export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();
    
    // Use current project and organization context
    const targetProjectId = project.id;
    const targetOrganizationId = organizationId;
    
    // Check permission to view notification providers
    const canView = await hasPermission('monitor', 'view', {
      organizationId: targetOrganizationId,
      projectId: targetProjectId
    });
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get notification providers scoped to the project
    // Using ID ordering instead of createdAt since UUIDv7 is time-ordered (PostgreSQL 18+)
    const providers = await db
      .select()
      .from(notificationProviders)
      .where(and(
        eq(notificationProviders.organizationId, targetOrganizationId),
        eq(notificationProviders.projectId, targetProjectId)
      ))
      .orderBy(desc(notificationProviders.id));

    if (providers.length === 0) {
      return NextResponse.json([]);
    }

    // OPTIMIZED: Batch fetch last used dates for all providers in one query
    const providerIds = providers.map(p => p.id);
    const lastAlerts = await db
      .select({
        provider: alertHistory.provider,
        sentAt: sql<Date>`MAX(${alertHistory.sentAt})`.as('sentAt'),
      })
      .from(alertHistory)
      .where(sql`${alertHistory.provider}::uuid = ANY(${providerIds}::uuid[])`)
      .groupBy(alertHistory.provider);

    // Build lookup map for O(1) access
    const lastAlertMap = new Map<string, Date>();
    lastAlerts.forEach(alert => {
      if (alert.provider) {
        lastAlertMap.set(alert.provider, alert.sentAt);
      }
    });

    // Enhance providers with last used information (no N+1 queries)
    const enhancedProviders = providers.map(provider => {
      const configContext = provider.projectId ?? undefined;
      const decryptedConfig = decryptNotificationProviderConfig(
        provider.config,
        configContext ?? undefined
      );
      const { sanitizedConfig, maskedFields } = sanitizeConfigForClient(
        provider.type as NotificationProviderType,
        decryptedConfig
      );

      return {
        ...provider,
        config: sanitizedConfig,
        maskedFields,
        lastUsed: lastAlertMap.get(provider.id) || null,
      };
    });

    return NextResponse.json(enhancedProviders);
  } catch (error) {
    console.error("Error fetching notification providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification providers" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    const rawData = await req.json();
    
    // Use current project and organization context
    const targetProjectId = project.id;
    const targetOrganizationId = organizationId;
    
    // Check permission to create notification providers
    const canCreate = await hasPermission('monitor', 'create', {
      organizationId: targetOrganizationId,
      projectId: targetProjectId
    });
    
    if (!canCreate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create notification providers' },
        { status: 403 }
      );
    }
    
    // Transform the data to match the database schema
    // The frontend sends { type, config } but the database expects { name, type, config, organizationId, projectId, createdByUserId }
    const transformedData = {
      name: rawData.config?.name || "Unnamed Provider",
      type: rawData.type,
      config: rawData.config,
      organizationId: targetOrganizationId,
      projectId: targetProjectId,
      createdByUserId: userId,
    };

    const validationResult = notificationProvidersInsertSchema.safeParse(transformedData);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const newProviderData = validationResult.data;

    const plainConfig = (newProviderData.config ??
      {}) as Record<string, unknown>;

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

    const encryptedConfig = encryptNotificationProviderConfig(
      plainConfig as PlainNotificationProviderConfig,
      targetProjectId
    );

    const [insertedProvider] = await db
      .insert(notificationProviders)
      .values({
        name: newProviderData.name!,
        type: newProviderData.type!,
        config: encryptedConfig,
        organizationId: newProviderData.organizationId,
        projectId: newProviderData.projectId,
        createdByUserId: newProviderData.createdByUserId,
      })
      .returning();

    // Log the audit event for notification provider creation
    await logAuditEvent({
      userId,
      organizationId,
      action: 'notification_provider_created',
      resource: 'notification_provider',
      resourceId: insertedProvider.id,
      metadata: {
        providerName: insertedProvider.name,
        providerType: insertedProvider.type,
        projectId: project.id,
        projectName: project.name
      },
      success: true
    });

    const decryptedConfig = decryptNotificationProviderConfig(
      insertedProvider.config,
      targetProjectId
    );
    const { sanitizedConfig, maskedFields } = sanitizeConfigForClient(
      insertedProvider.type as NotificationProviderType,
      decryptedConfig
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
    console.error("Error creating notification provider:", error);
    return NextResponse.json(
      { error: "Failed to create notification provider" },
      { status: 500 }
    );
  }
} 
