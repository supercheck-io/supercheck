import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  externalConnectorServices,
  externalConnectors,
  notificationProviders,
  sreIntegrationBindings,
  sreIntegrationBindingServices,
  type NotificationProviderType,
  type PlainNotificationProviderConfig,
} from "@/db/schema";
import { db } from "@/utils/db";
import { isAuthError, requireAuthContext, type AuthContext } from "@/lib/auth-context";
import {
  analyzeCliProjectConfigDeployRequest,
  type CliProjectConfigDeployError,
  type CliProjectConfigDeployValidationResult,
} from "@/lib/cli/project-config-deploy";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  decryptNotificationProviderConfig,
  encryptNotificationProviderConfig,
} from "@/lib/notification-providers/crypto";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  canBindIntegrationToConnector,
  getNotificationProviderIntegrationKey,
} from "@/lib/sre/integration-bindings";
import { createLogger } from "@/lib/logger/index";

export const dynamic = "force-dynamic";

const logger = createLogger({ module: "cli-project-config-deploy" }) as {
  error: (data: unknown, msg?: string) => void;
};

type DeployProviderContext = {
  id: string;
  type: NotificationProviderType;
  config: PlainNotificationProviderConfig;
  enabled: boolean;
};

type DeployConnectorContext = {
  id: string;
  type: string;
  status: string;
};

type CliProjectConfigApplyResult = {
  notificationProviders: Array<{
    index: number;
    id: string;
    action: "created" | "updated";
    name: string;
    type: NotificationProviderType;
  }>;
  sreIntegrationBindings: Array<{
    index: number;
    id: string;
    action: "created" | "updated";
    integrationKey: string;
    enabled: boolean;
  }>;
};

/**
 * POST /api/cli/project-config/deploy
 *
 * Deploy validation/apply endpoint for CLI/CI workflows.
 * Validates explicit deploy payloads and rejects redacted pull/diff snapshots.
 */
export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();

    const canUpdateNotifications = checkPermissionWithContext(
      "notification",
      "update",
      context,
    );
    const canConfigureSreConnectors = checkPermissionWithContext(
      "sre_connector",
      "configure",
      context,
    );
    const canCreateNotifications = checkPermissionWithContext(
      "notification",
      "create",
      context,
    );

    if (!canUpdateNotifications || !canConfigureSreConnectors) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const analysis = analyzeCliProjectConfigDeployRequest(body);
    if (
      analysis.plan.notificationProviders.some(
        (provider) => provider.action === "create",
      ) &&
      !canCreateNotifications
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions to create notification providers" },
        { status: 403 },
      );
    }

    if (!analysis.valid) {
      return NextResponse.json(
        {
          success: false,
          mode: analysis.plan.mode,
          errors: analysis.errors,
          warnings: analysis.warnings,
          plan: analysis.plan,
        },
        { status: 400 },
      );
    }

    const dbErrors = await validateDeployPlanAgainstDatabase(analysis, context);
    if (dbErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          mode: analysis.plan.mode,
          errors: dbErrors,
          warnings: analysis.warnings,
          plan: analysis.plan,
        },
        { status: 400 },
      );
    }

    if (analysis.plan.mode === "apply") {
      const applied = await applyDeployPlan(analysis, context);

      return NextResponse.json(
        {
          success: true,
          mode: "apply",
          warnings: analysis.warnings,
          plan: analysis.plan,
          applied,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        success: true,
        mode: analysis.plan.mode,
        warnings: analysis.warnings,
        plan: analysis.plan,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 },
      );
    }

    logger.error({ err: error }, "Failed to validate CLI project config deploy");
    return NextResponse.json(
      { error: "Failed to validate project config deploy" },
      { status: 500 },
    );
  }
}

async function validateDeployPlanAgainstDatabase(
  analysis: CliProjectConfigDeployValidationResult,
  context: AuthContext,
): Promise<CliProjectConfigDeployError[]> {
  const errors: CliProjectConfigDeployError[] = [];
  const providerContextById = new Map<string, DeployProviderContext>();
  const referencedProviderIds = new Set<string>();

  for (const provider of analysis.plan.notificationProviders) {
    if (provider.id) {
      referencedProviderIds.add(provider.id);
    }
  }
  for (const binding of analysis.plan.sreIntegrationBindings) {
    referencedProviderIds.add(binding.notificationProviderId);
  }

  const providersToLoad = Array.from(referencedProviderIds).filter(
    (id) => !providerContextById.has(id),
  );
  if (providersToLoad.length > 0) {
    const existingProviders = await db
      .select({
        id: notificationProviders.id,
        type: notificationProviders.type,
        config: notificationProviders.config,
        isEnabled: notificationProviders.isEnabled,
      })
      .from(notificationProviders)
      .where(
        and(
          eq(notificationProviders.organizationId, context.organizationId),
          eq(notificationProviders.projectId, context.project.id),
          inArray(notificationProviders.id, providersToLoad),
        ),
      );

    for (const provider of existingProviders) {
      providerContextById.set(provider.id, {
        id: provider.id,
        type: provider.type,
        enabled: provider.isEnabled,
        config: decryptNotificationProviderConfig(
          provider.config,
          context.project.id,
        ),
      });
    }
  }

  for (const provider of analysis.plan.notificationProviders) {
    if (provider.id && !providerContextById.has(provider.id)) {
      errors.push({
        path: `$.notificationProviders[${provider.index}].id`,
        message: "Notification provider not found.",
      });
    }
  }

  for (const provider of analysis.normalizedNotificationProviders) {
    if (provider.id) {
      providerContextById.set(provider.id, {
        id: provider.id,
        type: provider.type,
        config: provider.config,
        enabled: provider.enabled ?? true,
      });
    }
  }

  const existingBindingIds = new Set<string>();
  const bindingIds = analysis.plan.sreIntegrationBindings
    .map((binding) => binding.id)
    .filter((id): id is string => !!id);
  if (bindingIds.length > 0) {
    const existingBindings = await db
      .select({ id: sreIntegrationBindings.id })
      .from(sreIntegrationBindings)
      .where(
        and(
          eq(sreIntegrationBindings.organizationId, context.organizationId),
          eq(sreIntegrationBindings.projectId, context.project.id),
          inArray(sreIntegrationBindings.id, bindingIds),
        ),
      );
    existingBindings.forEach((binding) => existingBindingIds.add(binding.id));
  }

  const connectorIds = Array.from(
    new Set(
      analysis.plan.sreIntegrationBindings.map(
        (binding) => binding.externalConnectorId,
      ),
    ),
  );
  const connectorContextById = await loadConnectorContextById({
    organizationId: context.organizationId,
    projectId: context.project.id,
    connectorIds,
  });
  const serviceScopeByConnectorId = await loadServiceScopeByConnectorId({
    organizationId: context.organizationId,
    projectId: context.project.id,
    connectorIds,
    serviceIds: Array.from(
      new Set(
        analysis.plan.sreIntegrationBindings.flatMap(
          (binding) => binding.serviceIds,
        ),
      ),
    ),
  });

  for (const binding of analysis.plan.sreIntegrationBindings) {
    const bindingPath = `$.sreIntegrationBindings[${binding.index}]`;

    if (binding.id && !existingBindingIds.has(binding.id)) {
      errors.push({
        path: `${bindingPath}.id`,
        message: "SRE integration binding not found.",
      });
      continue;
    }

    const provider = providerContextById.get(binding.notificationProviderId);
    if (!provider || !provider.enabled) {
      errors.push({
        path: `${bindingPath}.notificationProviderId`,
        message: "Notification provider not found or disabled.",
      });
      continue;
    }

    const connector = connectorContextById.get(binding.externalConnectorId);
    if (!connector || connector.status === "disabled") {
      errors.push({
        path: `${bindingPath}.externalConnectorId`,
        message: "SRE connector not found or disabled.",
      });
      continue;
    }

    const derivedIntegrationKey = getNotificationProviderIntegrationKey({
      type: provider.type,
      config: provider.config,
    });
    if (derivedIntegrationKey !== binding.integrationKey) {
      errors.push({
        path: `${bindingPath}.integrationKey`,
        message:
          derivedIntegrationKey === null
            ? "Notification provider type does not support SRE connector binding."
            : `Integration key must match provider config (${derivedIntegrationKey}).`,
      });
    }

    if (!canBindIntegrationToConnector(binding.integrationKey, connector.type)) {
      errors.push({
        path: `${bindingPath}.externalConnectorId`,
        message: "Connector type does not match the notification integration.",
      });
    }

    const connectorServiceScope =
      serviceScopeByConnectorId.get(connector.id) ?? new Set<string>();
    const outOfScopeServiceId = binding.serviceIds.find(
      (serviceId) => !connectorServiceScope.has(serviceId),
    );
    if (outOfScopeServiceId) {
      errors.push({
        path: `${bindingPath}.serviceIds`,
        message: `Service ${outOfScopeServiceId} is not in scope for this connector.`,
      });
    }
  }

  const duplicateErrors = await validateActiveBindingUniqueness(
    analysis,
    context,
  );
  errors.push(...duplicateErrors);

  return errors;
}

async function validateActiveBindingUniqueness(
  analysis: CliProjectConfigDeployValidationResult,
  context: AuthContext,
): Promise<CliProjectConfigDeployError[]> {
  const errors: CliProjectConfigDeployError[] = [];
  const seenActiveBindings = new Map<string, number>();

  for (const binding of analysis.plan.sreIntegrationBindings) {
    if (!binding.enabled) {
      continue;
    }

    const bindingKey = [
      binding.integrationKey,
      binding.notificationProviderId,
      binding.externalConnectorId,
    ].join(":");
    const existingIndex = seenActiveBindings.get(bindingKey);
    if (existingIndex !== undefined) {
      errors.push({
        path: `$.sreIntegrationBindings[${binding.index}]`,
        message: `Duplicate active binding in payload; first occurrence is at index ${existingIndex}.`,
      });
      continue;
    }
    seenActiveBindings.set(bindingKey, binding.index);

    const existingActive = await db
      .select({ id: sreIntegrationBindings.id })
      .from(sreIntegrationBindings)
      .where(
        and(
          eq(sreIntegrationBindings.organizationId, context.organizationId),
          eq(sreIntegrationBindings.projectId, context.project.id),
          eq(sreIntegrationBindings.integrationKey, binding.integrationKey),
          eq(
            sreIntegrationBindings.notificationProviderId,
            binding.notificationProviderId,
          ),
          eq(
            sreIntegrationBindings.externalConnectorId,
            binding.externalConnectorId,
          ),
          eq(sreIntegrationBindings.enabled, true),
        ),
      )
      .limit(2);

    const conflict = existingActive.find((row) => row.id !== binding.id);
    if (conflict) {
      errors.push({
        path: `$.sreIntegrationBindings[${binding.index}]`,
        message:
          "An active binding already exists for this provider and connector.",
      });
    }
  }

  return errors;
}

async function applyDeployPlan(
  analysis: CliProjectConfigDeployValidationResult,
  context: AuthContext,
): Promise<CliProjectConfigApplyResult> {
  const now = new Date();
  const applied = await db.transaction(async (tx) => {
    const result: CliProjectConfigApplyResult = {
      notificationProviders: [],
      sreIntegrationBindings: [],
    };

    for (const provider of analysis.normalizedNotificationProviders) {
      const encryptedConfig = encryptNotificationProviderConfig(
        provider.config,
        context.project.id,
      );
      const isEnabled = provider.enabled ?? true;

      if (provider.id) {
        const [updated] = await tx
          .update(notificationProviders)
          .set({
            name: provider.name,
            type: provider.type,
            config: encryptedConfig,
            isEnabled,
            updatedAt: now,
          })
          .where(
            and(
              eq(notificationProviders.id, provider.id),
              eq(notificationProviders.organizationId, context.organizationId),
              eq(notificationProviders.projectId, context.project.id),
            ),
          )
          .returning({ id: notificationProviders.id });

        if (updated) {
          result.notificationProviders.push({
            index: provider.index,
            id: updated.id,
            action: "updated",
            name: provider.name,
            type: provider.type,
          });
        }
      } else {
        const [created] = await tx
          .insert(notificationProviders)
          .values({
            organizationId: context.organizationId,
            projectId: context.project.id,
            createdByUserId: context.userId,
            name: provider.name,
            type: provider.type,
            config: encryptedConfig,
            isEnabled,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: notificationProviders.id });

        result.notificationProviders.push({
          index: provider.index,
          id: created.id,
          action: "created",
          name: provider.name,
          type: provider.type,
        });
      }
    }

    for (const binding of analysis.plan.sreIntegrationBindings) {
      if (binding.id) {
        const [updated] = await tx
          .update(sreIntegrationBindings)
          .set({
            integrationKey: binding.integrationKey,
            notificationProviderId: binding.notificationProviderId,
            externalConnectorId: binding.externalConnectorId,
            correlationStrategy: binding.correlationStrategy,
            enabled: binding.enabled,
            updatedAt: now,
          })
          .where(
            and(
              eq(sreIntegrationBindings.id, binding.id),
              eq(sreIntegrationBindings.organizationId, context.organizationId),
              eq(sreIntegrationBindings.projectId, context.project.id),
            ),
          )
          .returning({ id: sreIntegrationBindings.id });

        if (updated) {
          await replaceBindingServices({
            tx,
            organizationId: context.organizationId,
            projectId: context.project.id,
            bindingId: updated.id,
            serviceIds: binding.serviceIds,
            now,
          });
          result.sreIntegrationBindings.push({
            index: binding.index,
            id: updated.id,
            action: "updated",
            integrationKey: binding.integrationKey,
            enabled: binding.enabled,
          });
        }
      } else {
        const [created] = await tx
          .insert(sreIntegrationBindings)
          .values({
            organizationId: context.organizationId,
            projectId: context.project.id,
            integrationKey: binding.integrationKey,
            notificationProviderId: binding.notificationProviderId,
            externalConnectorId: binding.externalConnectorId,
            correlationStrategy: binding.correlationStrategy,
            enabled: binding.enabled,
            metadata: { source: "cli_project_config_deploy" },
            createdByUserId: context.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: sreIntegrationBindings.id });

        await replaceBindingServices({
          tx,
          organizationId: context.organizationId,
          projectId: context.project.id,
          bindingId: created.id,
          serviceIds: binding.serviceIds,
          now,
        });
        result.sreIntegrationBindings.push({
          index: binding.index,
          id: created.id,
          action: "created",
          integrationKey: binding.integrationKey,
          enabled: binding.enabled,
        });
      }
    }

    return result;
  });

  await logAuditEvent({
    userId: context.userId,
    organizationId: context.organizationId,
    action: "cli_project_config_applied",
    resource: "cli_project_config",
    metadata: {
      projectId: context.project.id,
      notificationProviderCount: applied.notificationProviders.length,
      sreIntegrationBindingCount: applied.sreIntegrationBindings.length,
      notificationProviderActions: applied.notificationProviders.map((item) => ({
        id: item.id,
        action: item.action,
        type: item.type,
      })),
      sreIntegrationBindingActions: applied.sreIntegrationBindings.map((item) => ({
        id: item.id,
        action: item.action,
        integrationKey: item.integrationKey,
        enabled: item.enabled,
      })),
    },
    success: true,
  });

  return applied;
}

async function replaceBindingServices(input: {
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
  organizationId: string;
  projectId: string;
  bindingId: string;
  serviceIds: string[];
  now: Date;
}) {
  await input.tx
    .delete(sreIntegrationBindingServices)
    .where(
      and(
        eq(sreIntegrationBindingServices.organizationId, input.organizationId),
        eq(sreIntegrationBindingServices.projectId, input.projectId),
        eq(sreIntegrationBindingServices.bindingId, input.bindingId),
      ),
    );

  if (input.serviceIds.length === 0) {
    return;
  }

  await input.tx.insert(sreIntegrationBindingServices).values(
    input.serviceIds.map((serviceId) => ({
      organizationId: input.organizationId,
      projectId: input.projectId,
      bindingId: input.bindingId,
      serviceId,
      createdAt: input.now,
    })),
  );
}

async function loadConnectorContextById(input: {
  organizationId: string;
  projectId: string;
  connectorIds: string[];
}): Promise<Map<string, DeployConnectorContext>> {
  if (input.connectorIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      id: externalConnectors.id,
      type: externalConnectors.type,
      status: externalConnectors.status,
    })
    .from(externalConnectors)
    .where(
      and(
        eq(externalConnectors.organizationId, input.organizationId),
        eq(externalConnectors.projectId, input.projectId),
        inArray(externalConnectors.id, input.connectorIds),
      ),
    );

  return new Map(rows.map((row) => [row.id, row]));
}

async function loadServiceScopeByConnectorId(input: {
  organizationId: string;
  projectId: string;
  connectorIds: string[];
  serviceIds: string[];
}): Promise<Map<string, Set<string>>> {
  if (input.connectorIds.length === 0 || input.serviceIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      connectorId: externalConnectorServices.connectorId,
      serviceId: externalConnectorServices.serviceId,
    })
    .from(externalConnectorServices)
    .where(
      and(
        eq(externalConnectorServices.organizationId, input.organizationId),
        eq(externalConnectorServices.projectId, input.projectId),
        inArray(externalConnectorServices.connectorId, input.connectorIds),
        inArray(externalConnectorServices.serviceId, input.serviceIds),
      ),
    );

  return rows.reduce((acc, row) => {
    const serviceIds = acc.get(row.connectorId) ?? new Set<string>();
    serviceIds.add(row.serviceId);
    acc.set(row.connectorId, serviceIds);
    return acc;
  }, new Map<string, Set<string>>());
}
