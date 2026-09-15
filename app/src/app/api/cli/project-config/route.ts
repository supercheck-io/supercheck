import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  externalConnectors,
  notificationProviders,
  sreIntegrationBindings,
  sreIntegrationBindingServices,
  type PlainNotificationProviderConfig,
  type NotificationProviderType,
} from "@/db/schema";
import { db } from "@/utils/db";
import { isAuthError, requireAuthContext } from "@/lib/auth-context";
import {
  buildCliProjectConfigSnapshot,
  type CliProjectConfigSreIntegrationBindingInput,
} from "@/lib/cli/project-config";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { createLogger } from "@/lib/logger/index";

export const dynamic = "force-dynamic";

const logger = createLogger({ module: "cli-project-config" }) as {
  error: (data: unknown, msg?: string) => void;
};

/**
 * GET /api/cli/project-config
 *
 * Read-only CLI/CI snapshot for pull and diff workflows.
 * Supports both Bearer CLI tokens and browser sessions via requireAuthContext().
 *
 * Security: intentionally returns redacted notification provider configuration.
 * Endpoint URLs, tokens, headers, and custom body templates are never returned.
 */
export async function GET() {
  try {
    const context = await requireAuthContext();

    const canViewNotifications = checkPermissionWithContext(
      "notification",
      "view",
      context,
    );
    const canViewSreConnectors = checkPermissionWithContext(
      "sre_connector",
      "view",
      context,
    );

    if (!canViewNotifications || !canViewSreConnectors) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const [providerRows, bindingRows] = await Promise.all([
      dbSelectNotificationProviders(context.organizationId, context.project.id),
      dbSelectSreIntegrationBindings(context.organizationId, context.project.id),
    ]);

    const serviceIdsByBindingId = await getServiceIdsByBindingId({
      organizationId: context.organizationId,
      projectId: context.project.id,
      bindingIds: bindingRows.map((binding) => binding.id),
    });

    const snapshot = buildCliProjectConfigSnapshot({
      generatedAt: new Date(),
      hashKey: getCliSnapshotHashKey(),
      organization: {
        id: context.organizationId,
        name: context.organizationName ?? null,
        slug: context.organizationSlug ?? null,
      },
      project: {
        id: context.project.id,
        name: context.project.name,
        slug: context.project.slug ?? null,
      },
      notificationProviders: providerRows.map((provider) => ({
        id: provider.id,
        name: provider.name,
        type: provider.type as NotificationProviderType,
        isEnabled: provider.isEnabled,
        config: decryptNotificationProviderConfig(
          provider.config,
          context.project.id,
        ) as PlainNotificationProviderConfig,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      })),
      sreIntegrationBindings: bindingRows.map((binding) => ({
        ...binding,
        serviceIds: serviceIdsByBindingId.get(binding.id) ?? [],
      })),
    });

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 },
      );
    }

    logger.error({ err: error }, "Failed to build CLI project config snapshot");
    return NextResponse.json(
      { error: "Failed to build project config snapshot" },
      { status: 500 },
    );
  }
}

async function dbSelectNotificationProviders(
  organizationId: string,
  projectId: string,
) {
  return db
    .select({
      id: notificationProviders.id,
      name: notificationProviders.name,
      type: notificationProviders.type,
      config: notificationProviders.config,
      isEnabled: notificationProviders.isEnabled,
      createdAt: notificationProviders.createdAt,
      updatedAt: notificationProviders.updatedAt,
    })
    .from(notificationProviders)
    .where(
      and(
        eq(notificationProviders.organizationId, organizationId),
        eq(notificationProviders.projectId, projectId),
      ),
    )
    .orderBy(asc(notificationProviders.name), asc(notificationProviders.id));
}

async function dbSelectSreIntegrationBindings(
  organizationId: string,
  projectId: string,
): Promise<Omit<CliProjectConfigSreIntegrationBindingInput, "serviceIds">[]> {
  return db
    .select({
      id: sreIntegrationBindings.id,
      integrationKey: sreIntegrationBindings.integrationKey,
      correlationStrategy: sreIntegrationBindings.correlationStrategy,
      enabled: sreIntegrationBindings.enabled,
      notificationProviderId: sreIntegrationBindings.notificationProviderId,
      externalConnectorId: externalConnectors.id,
      externalConnectorName: externalConnectors.name,
      externalConnectorType: externalConnectors.type,
      externalConnectorStatus: externalConnectors.status,
      createdAt: sreIntegrationBindings.createdAt,
      updatedAt: sreIntegrationBindings.updatedAt,
    })
    .from(sreIntegrationBindings)
    .innerJoin(
      externalConnectors,
      eq(sreIntegrationBindings.externalConnectorId, externalConnectors.id),
    )
    .where(
      and(
        eq(sreIntegrationBindings.organizationId, organizationId),
        eq(sreIntegrationBindings.projectId, projectId),
        eq(externalConnectors.organizationId, organizationId),
        eq(externalConnectors.projectId, projectId),
      ),
    )
    .orderBy(
      asc(sreIntegrationBindings.integrationKey),
      asc(sreIntegrationBindings.id),
    );
}

async function getServiceIdsByBindingId(input: {
  organizationId: string;
  projectId: string;
  bindingIds: string[];
}): Promise<Map<string, string[]>> {
  if (input.bindingIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      bindingId: sreIntegrationBindingServices.bindingId,
      serviceId: sreIntegrationBindingServices.serviceId,
    })
    .from(sreIntegrationBindingServices)
    .where(
      and(
        eq(sreIntegrationBindingServices.organizationId, input.organizationId),
        eq(sreIntegrationBindingServices.projectId, input.projectId),
        inArray(sreIntegrationBindingServices.bindingId, input.bindingIds),
      ),
    )
    .orderBy(
      asc(sreIntegrationBindingServices.bindingId),
      asc(sreIntegrationBindingServices.serviceId),
    );

  return rows.reduce((acc, row) => {
    const serviceIds = acc.get(row.bindingId) ?? [];
    serviceIds.push(row.serviceId);
    acc.set(row.bindingId, serviceIds);
    return acc;
  }, new Map<string, string[]>());
}

function getCliSnapshotHashKey(): string {
  return (
    process.env.NOTIFICATION_CONFIG_FINGERPRINT_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    "supercheck-cli-config-redaction-development"
  );
}
