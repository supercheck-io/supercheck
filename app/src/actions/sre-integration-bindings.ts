"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  externalConnectors,
  externalConnectorServices,
  notificationProviders,
  sreIntegrationBindings,
  sreIntegrationBindingServices,
  sreServices,
  type NotificationProviderConfig,
  type NotificationProviderType,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext, type ProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import {
  SRE_INTEGRATION_CORRELATION_STRATEGIES,
  canBindIntegrationToConnector,
  getDefaultCorrelationStrategy,
  getNotificationProviderIntegrationKey,
  type SreIntegrationCorrelationStrategy,
  type SreIntegrationKey,
} from "@/lib/sre/integration-bindings";
import { db } from "@/utils/db";

const jsonMetadataSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string().max(200), z.number(), z.boolean()])).max(50),
  ]),
);

const createIntegrationBindingSchema = z.object({
  notificationProviderId: z.string().uuid(),
  externalConnectorId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).max(50).default([]),
  correlationStrategy: z.enum(SRE_INTEGRATION_CORRELATION_STRATEGIES).optional(),
  metadata: jsonMetadataSchema.default({}),
});

const disableIntegrationBindingSchema = z.object({
  id: z.string().uuid(),
});

export type SreIntegrationBindingListItem = {
  id: string;
  integrationKey: SreIntegrationKey;
  correlationStrategy: SreIntegrationCorrelationStrategy;
  enabled: boolean;
  notificationProvider: {
    id: string;
    name: string;
    type: NotificationProviderType;
  };
  externalConnector: {
    id: string;
    name: string;
    type: string;
    status: string;
  };
  services: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
};

export type SreIntegrationBindingActionResult =
  | { success: true; binding?: SreIntegrationBindingListItem; message: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreIntegrationBindingSetupOptions = {
  notificationProviders: Array<{
    id: string;
    name: string;
    type: NotificationProviderType;
    integrationKey: SreIntegrationKey;
    defaultCorrelationStrategy: SreIntegrationCorrelationStrategy;
  }>;
  connectors: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
  }>;
  services: Array<{ id: string; name: string }>;
};

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).filter(([, errors]) => errors && errors.length > 0),
  ) as Record<string, string[]>;
}

function assertCanViewBindings(
  userId: string,
  organizationId: string,
  project: ProjectContext,
) {
  const canViewConnectors = checkPermissionWithContext("sre_connector", "view", {
    userId,
    organizationId,
    project,
  });
  const canViewNotifications = checkPermissionWithContext("notification", "view", {
    userId,
    organizationId,
    project,
  });

  if (!canViewConnectors || !canViewNotifications) {
    throw new Error("Insufficient permissions to view SRE integration bindings");
  }
}

function assertCanConfigureBindings(
  userId: string,
  organizationId: string,
  project: ProjectContext,
) {
  const canConfigureConnectors = checkPermissionWithContext(
    "sre_connector",
    "configure",
    { userId, organizationId, project },
  );
  const canUpdateNotifications = checkPermissionWithContext(
    "notification",
    "update",
    { userId, organizationId, project },
  );

  if (!canConfigureConnectors || !canUpdateNotifications) {
    throw new Error("Insufficient permissions to configure SRE integration bindings");
  }
}

async function getBindingListItems(
  organizationId: string,
  projectId: string,
  bindingIds?: string[],
): Promise<SreIntegrationBindingListItem[]> {
  const bindingRows = await db
    .select({
      id: sreIntegrationBindings.id,
      integrationKey: sreIntegrationBindings.integrationKey,
      correlationStrategy: sreIntegrationBindings.correlationStrategy,
      enabled: sreIntegrationBindings.enabled,
      notificationProviderId: notificationProviders.id,
      notificationProviderName: notificationProviders.name,
      notificationProviderType: notificationProviders.type,
      externalConnectorId: externalConnectors.id,
      externalConnectorName: externalConnectors.name,
      externalConnectorType: externalConnectors.type,
      externalConnectorStatus: externalConnectors.status,
      createdAt: sreIntegrationBindings.createdAt,
      updatedAt: sreIntegrationBindings.updatedAt,
    })
    .from(sreIntegrationBindings)
    .innerJoin(
      notificationProviders,
      eq(sreIntegrationBindings.notificationProviderId, notificationProviders.id),
    )
    .innerJoin(
      externalConnectors,
      eq(sreIntegrationBindings.externalConnectorId, externalConnectors.id),
    )
    .where(
      and(
        eq(sreIntegrationBindings.organizationId, organizationId),
        eq(sreIntegrationBindings.projectId, projectId),
        ...(bindingIds && bindingIds.length > 0
          ? [inArray(sreIntegrationBindings.id, bindingIds)]
          : []),
      ),
    )
    .orderBy(desc(sreIntegrationBindings.createdAt))
    .limit(100);

  if (bindingRows.length === 0) {
    return [];
  }

  const services = await db
    .select({
      bindingId: sreIntegrationBindingServices.bindingId,
      serviceId: sreServices.id,
      serviceName: sreServices.name,
    })
    .from(sreIntegrationBindingServices)
    .innerJoin(sreServices, eq(sreIntegrationBindingServices.serviceId, sreServices.id))
    .where(
      and(
        eq(sreIntegrationBindingServices.organizationId, organizationId),
        eq(sreIntegrationBindingServices.projectId, projectId),
        inArray(
          sreIntegrationBindingServices.bindingId,
          bindingRows.map((row) => row.id),
        ),
      ),
    );

  const servicesByBinding = new Map<string, Array<{ id: string; name: string }>>();
  for (const service of services) {
    const current = servicesByBinding.get(service.bindingId) ?? [];
    current.push({ id: service.serviceId, name: service.serviceName });
    servicesByBinding.set(service.bindingId, current);
  }

  return bindingRows.map((row) => ({
    id: row.id,
    integrationKey: row.integrationKey,
    correlationStrategy: row.correlationStrategy,
    enabled: row.enabled,
    notificationProvider: {
      id: row.notificationProviderId,
      name: row.notificationProviderName,
      type: row.notificationProviderType,
    },
    externalConnector: {
      id: row.externalConnectorId,
      name: row.externalConnectorName,
      type: row.externalConnectorType,
      status: row.externalConnectorStatus,
    },
    services: servicesByBinding.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function getBindingListItem(
  id: string,
  organizationId: string,
  projectId: string,
): Promise<SreIntegrationBindingListItem | null> {
  const [binding] = await getBindingListItems(organizationId, projectId, [id]);
  return binding ?? null;
}

async function assertValidServiceScope(input: {
  organizationId: string;
  projectId: string;
  connectorId: string;
  serviceIds: string[];
}) {
  if (input.serviceIds.length === 0) {
    const scopedConnectorServices = await db
      .select({ serviceId: externalConnectorServices.serviceId })
      .from(externalConnectorServices)
      .where(
        and(
          eq(externalConnectorServices.organizationId, input.organizationId),
          eq(externalConnectorServices.projectId, input.projectId),
          eq(externalConnectorServices.connectorId, input.connectorId),
        ),
      );

    if (scopedConnectorServices.length > 0) {
      throw new Error("Select at least one service within the connector scope.");
    }

    return;
  }

  const existingServices = await db
    .select({ id: sreServices.id })
    .from(sreServices)
    .where(
      and(
        eq(sreServices.organizationId, input.organizationId),
        eq(sreServices.projectId, input.projectId),
        inArray(sreServices.id, input.serviceIds),
      ),
    );

  if (existingServices.length !== input.serviceIds.length) {
    throw new Error("One or more selected services were not found.");
  }

  const scopedConnectorServices = await db
    .select({ serviceId: externalConnectorServices.serviceId })
    .from(externalConnectorServices)
    .where(
      and(
        eq(externalConnectorServices.organizationId, input.organizationId),
        eq(externalConnectorServices.projectId, input.projectId),
        eq(externalConnectorServices.connectorId, input.connectorId),
      ),
    );

  if (scopedConnectorServices.length === 0) {
    return;
  }

  const allowedServiceIds = new Set(
    scopedConnectorServices.map((service) => service.serviceId),
  );
  const outsideConnectorScope = input.serviceIds.find(
    (serviceId) => !allowedServiceIds.has(serviceId),
  );

  if (outsideConnectorScope) {
    throw new Error("Selected services must be within the connector scope.");
  }
}

export async function getSreIntegrationBindings(): Promise<
  | { success: true; bindings: SreIntegrationBindingListItem[] }
  | { success: false; error: string; bindings: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanViewBindings(userId, organizationId, project);

    const bindings = await getBindingListItems(organizationId, project.id);
    return { success: true, bindings };
  } catch (error) {
    console.error("Error fetching SRE integration bindings:", error);
    return {
      success: false,
      error: "Failed to fetch SRE integration bindings",
      bindings: [],
    };
  }
}

export async function getSreIntegrationBindingSetupOptions(): Promise<
  | { success: true; options: SreIntegrationBindingSetupOptions }
  | { success: false; error: string; options: SreIntegrationBindingSetupOptions }
> {
  const emptyOptions: SreIntegrationBindingSetupOptions = {
    notificationProviders: [],
    connectors: [],
    services: [],
  };

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanViewBindings(userId, organizationId, project);

    const [providerRows, connectorRows, serviceRows] = await Promise.all([
      db
        .select({
          id: notificationProviders.id,
          name: notificationProviders.name,
          type: notificationProviders.type,
          config: notificationProviders.config,
        })
        .from(notificationProviders)
        .where(
          and(
            eq(notificationProviders.organizationId, organizationId),
            eq(notificationProviders.projectId, project.id),
            eq(notificationProviders.isEnabled, true),
          ),
        )
        .orderBy(notificationProviders.name),
      db
        .select({
          id: externalConnectors.id,
          name: externalConnectors.name,
          type: externalConnectors.type,
          status: externalConnectors.status,
        })
        .from(externalConnectors)
        .where(
          and(
            eq(externalConnectors.organizationId, organizationId),
            eq(externalConnectors.projectId, project.id),
          ),
        )
        .orderBy(externalConnectors.name),
      db
        .select({ id: sreServices.id, name: sreServices.name })
        .from(sreServices)
        .where(
          and(
            eq(sreServices.organizationId, organizationId),
            eq(sreServices.projectId, project.id),
            eq(sreServices.status, "active"),
          ),
        )
        .orderBy(sreServices.name),
    ]);

    const bindableProviders = providerRows
      .map((provider) => {
        const integrationKey = getNotificationProviderIntegrationKey({
          type: provider.type,
          config: provider.config as NotificationProviderConfig,
        });

        if (!integrationKey) {
          return null;
        }

        return {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          integrationKey,
          defaultCorrelationStrategy: getDefaultCorrelationStrategy(integrationKey),
        };
      })
      .filter((provider): provider is SreIntegrationBindingSetupOptions["notificationProviders"][number] =>
        Boolean(provider),
      );

    const bindableConnectors = connectorRows.filter((connector) =>
      bindableProviders.some((provider) =>
        canBindIntegrationToConnector(provider.integrationKey, connector.type),
      ),
    );

    return {
      success: true,
      options: {
        notificationProviders: bindableProviders,
        connectors: bindableConnectors,
        services: serviceRows,
      },
    };
  } catch (error) {
    console.error("Error fetching SRE integration binding setup options:", error);
    return {
      success: false,
      error: "Failed to fetch SRE integration binding setup options",
      options: emptyOptions,
    };
  }
}

export async function createSreIntegrationBinding(
  input: z.infer<typeof createIntegrationBindingSchema>,
): Promise<SreIntegrationBindingActionResult> {
  const parsed = createIntegrationBindingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid integration binding",
      fieldErrors: formatValidationErrors(parsed.error),
    };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureBindings(userId, organizationId, project);

    const [provider] = await db
      .select({
        id: notificationProviders.id,
        type: notificationProviders.type,
        config: notificationProviders.config,
        isEnabled: notificationProviders.isEnabled,
      })
      .from(notificationProviders)
      .where(
        and(
          eq(notificationProviders.id, parsed.data.notificationProviderId),
          eq(notificationProviders.organizationId, organizationId),
          eq(notificationProviders.projectId, project.id),
        ),
      )
      .limit(1);

    if (!provider || !provider.isEnabled) {
      return { success: false, error: "Notification provider not found or disabled" };
    }

    const [connector] = await db
      .select({
        id: externalConnectors.id,
        type: externalConnectors.type,
        status: externalConnectors.status,
      })
      .from(externalConnectors)
      .where(
        and(
          eq(externalConnectors.id, parsed.data.externalConnectorId),
          eq(externalConnectors.organizationId, organizationId),
          eq(externalConnectors.projectId, project.id),
        ),
      )
      .limit(1);

    if (!connector || connector.status === "disabled") {
      return { success: false, error: "SRE connector not found or disabled" };
    }

    const integrationKey = getNotificationProviderIntegrationKey({
      type: provider.type,
      config: provider.config as NotificationProviderConfig,
    });

    if (!integrationKey) {
      return {
        success: false,
        error: "Notification provider type does not support SRE connector binding.",
      };
    }

    if (!canBindIntegrationToConnector(integrationKey, connector.type)) {
      return {
        success: false,
        error: "Connector type does not match the notification integration.",
      };
    }

    const serviceIds = Array.from(new Set(parsed.data.serviceIds));
    try {
      await assertValidServiceScope({
        organizationId,
        projectId: project.id,
        connectorId: connector.id,
        serviceIds,
      });
    } catch (scopeError) {
      return {
        success: false,
        error:
          scopeError instanceof Error
            ? scopeError.message
            : "Invalid binding service scope.",
      };
    }

    const correlationStrategy =
      parsed.data.correlationStrategy ??
      getDefaultCorrelationStrategy(integrationKey);

    const [existing] = await db
      .select({ id: sreIntegrationBindings.id })
      .from(sreIntegrationBindings)
      .where(
        and(
          eq(sreIntegrationBindings.organizationId, organizationId),
          eq(sreIntegrationBindings.projectId, project.id),
          eq(sreIntegrationBindings.integrationKey, integrationKey),
          eq(sreIntegrationBindings.notificationProviderId, provider.id),
          eq(sreIntegrationBindings.externalConnectorId, connector.id),
          eq(sreIntegrationBindings.enabled, true),
        ),
      )
      .limit(1);

    if (existing) {
      return { success: false, error: "An active binding already exists for this provider and connector." };
    }

    const now = new Date();
    const created = await db.transaction(async (tx) => {
      const [binding] = await tx
        .insert(sreIntegrationBindings)
        .values({
          organizationId,
          projectId: project.id,
          integrationKey,
          notificationProviderId: provider.id,
          externalConnectorId: connector.id,
          correlationStrategy,
          enabled: true,
          metadata: parsed.data.metadata,
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (serviceIds.length > 0) {
        await tx.insert(sreIntegrationBindingServices).values(
          serviceIds.map((serviceId) => ({
            organizationId,
            projectId: project.id,
            bindingId: binding.id,
            serviceId,
            createdAt: now,
          })),
        );
      }

      return binding;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_integration_binding_created",
      resource: "sre_integration_binding",
      resourceId: created.id,
      metadata: {
        projectId: project.id,
        integrationKey,
        notificationProviderId: provider.id,
        externalConnectorId: connector.id,
        correlationStrategy,
        scopedServiceCount: serviceIds.length,
      },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/integrations");
    return {
      success: true,
      binding: (await getBindingListItem(created.id, organizationId, project.id)) ?? undefined,
      message: "SRE integration binding created",
    };
  } catch (error) {
    console.error("Error creating SRE integration binding:", error);
    return { success: false, error: "Failed to create SRE integration binding" };
  }
}

export async function disableSreIntegrationBinding(
  input: z.infer<typeof disableIntegrationBindingSchema>,
): Promise<SreIntegrationBindingActionResult> {
  const parsed = disableIntegrationBindingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid integration binding",
      fieldErrors: formatValidationErrors(parsed.error),
    };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    assertCanConfigureBindings(userId, organizationId, project);

    const [updated] = await db
      .update(sreIntegrationBindings)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(sreIntegrationBindings.id, parsed.data.id),
          eq(sreIntegrationBindings.organizationId, organizationId),
          eq(sreIntegrationBindings.projectId, project.id),
        ),
      )
      .returning();

    if (!updated) {
      return { success: false, error: "SRE integration binding not found" };
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_integration_binding_disabled",
      resource: "sre_integration_binding",
      resourceId: updated.id,
      metadata: {
        projectId: project.id,
        integrationKey: updated.integrationKey,
        notificationProviderId: updated.notificationProviderId,
        externalConnectorId: updated.externalConnectorId,
      },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/org-admin/integrations");
    return {
      success: true,
      binding: (await getBindingListItem(updated.id, organizationId, project.id)) ?? undefined,
      message: "SRE integration binding disabled",
    };
  } catch (error) {
    console.error("Error disabling SRE integration binding:", error);
    return { success: false, error: "Failed to disable SRE integration binding" };
  }
}
