"use server";

import { revalidatePath } from "next/cache";
import { and, count, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/utils/db";
import {
  jobs,
  k6PerformanceRuns,
  monitors,
  sreAlertEvents,
  sreIncidents,
  sreServiceDependencies,
  sreServiceDeployments,
  sreServiceDiscoverySuggestions,
  sreServiceHealthSnapshots,
  sreServiceResources,
  sreServices,
  statusPageComponents,
  statusPages,
  tests,
} from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger/index";

const logger = createLogger({ module: "sre-services" }) as {
  error: (data: unknown, message?: string) => void;
};

const serviceTierSchema = z.enum(["1", "2", "3", "4"]);
const serviceStatusSchema = z.enum(["active", "deprecated", "merged"]);
const optionalHttpUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a valid HTTP or HTTPS repository URL");

const serviceInputSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  tier: serviceTierSchema.default("3"),
  environment: z.string().trim().max(50).optional().nullable(),
  ownerTeam: z.string().trim().max(100).optional().nullable(),
  repoUrl: optionalHttpUrlSchema.optional(),
  otelServiceName: z.string().trim().max(100).optional().nullable(),
  slackChannel: z.string().trim().max(100).optional().nullable(),
  status: serviceStatusSchema.default("active"),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

const updateServiceInputSchema = serviceInputSchema.extend({
  id: z.string().uuid(),
});

const archiveServiceInputSchema = z.object({
  id: z.string().uuid(),
});

const dependencyInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    sourceServiceId: z.string().uuid(),
    targetServiceId: z.string().uuid(),
  })
  .refine((value) => value.sourceServiceId !== value.targetServiceId, {
    message: "A service cannot depend on itself",
    path: ["targetServiceId"],
  });

const dependencyIdSchema = z.object({ id: z.string().uuid() });
const resourceTypeSchema = z.enum(["monitor", "job", "test", "status_page_component", "k6_run"]);
const resourceRelationshipSchema = z.enum(["monitors", "owned", "depends_on"]);
const resourceInputSchema = z.object({
  serviceId: z.string().uuid(),
  resourceType: resourceTypeSchema,
  resourceId: z.string().uuid(),
  relationship: resourceRelationshipSchema,
});
const resourceIdSchema = z.object({ id: z.string().uuid(), serviceId: z.string().uuid() });
const suggestionDecisionSchema = z.object({ id: z.string().uuid() });
const dependencySuggestionDataSchema = z
  .object({
    sourceServiceId: z.string().uuid(),
    targetServiceId: z.string().uuid(),
    sourceRef: z.string().trim().max(255).optional(),
  })
  .refine((value) => value.sourceServiceId !== value.targetServiceId, {
    message: "A service cannot depend on itself",
  });

export type SreServiceListItem = {
  id: string;
  name: string;
  description: string | null;
  tier: "1" | "2" | "3" | "4";
  environment: string | null;
  ownerTeam: string | null;
  repoUrl: string | null;
  otelServiceName: string | null;
  slackChannel: string | null;
  status: "active" | "deprecated" | "merged";
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceActionResult =
  | { success: true; service?: SreServiceListItem; message: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type SreServiceDependencyItem = {
  id: string;
  sourceServiceId: string;
  sourceServiceName: string;
  targetServiceId: string;
  targetServiceName: string;
  source: "manual" | "native" | "connector_observed" | "ai_suggested";
  sourceRef: string | null;
  confidence: number | null;
  approvedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: "active" | "stale" | "rejected";
};

export type SreServiceResourceItem = {
  id: string;
  resourceType: "monitor" | "job" | "test" | "status_page_component" | "k6_run";
  resourceId: string;
  resourceName: string;
  relationship: "monitors" | "owned" | "depends_on";
  createdAt: Date;
};

export type SreServiceResourceCandidate = {
  id: string;
  name: string;
  type: SreServiceResourceItem["resourceType"];
};

export type SreServiceSuggestionItem = {
  id: string;
  source: string;
  confidence: number | null;
  sourceServiceId: string;
  sourceServiceName: string;
  targetServiceId: string;
  targetServiceName: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
};

export type SreServiceHealthRollup = {
  health: "healthy" | "degraded" | "failing" | "unknown";
  score: number | null;
  stale: boolean;
  calculatedAt: Date;
  explanation: string;
  activeIncidentCount: number;
  firingAlertCount: number;
};

export type SreServiceDetail = {
  service: SreServiceListItem;
  services: Array<Pick<SreServiceListItem, "id" | "name" | "status">>;
  dependencies: SreServiceDependencyItem[];
  resources: SreServiceResourceItem[];
  resourceCandidates: SreServiceResourceCandidate[];
  suggestions: SreServiceSuggestionItem[];
  health: SreServiceHealthRollup;
  recentIncidents: Array<{
    id: string;
    incidentNumber: number;
    title: string;
    severity: "sev1" | "sev2" | "sev3" | "sev4";
    status: string;
    updatedAt: Date;
  }>;
  recentAlerts: Array<{
    id: string;
    title: string;
    severity: "sev1" | "sev2" | "sev3" | "sev4";
    status: string;
    firedAt: Date;
  }>;
  recentDeployments: Array<{
    id: string;
    source: "github" | "kubernetes" | "ci";
    commitSha: string | null;
    commitMessage: string | null;
    deployedAt: Date;
  }>;
  permissions: {
    canEdit: boolean;
    canConfigure: boolean;
  };
};

type ServiceContext = Awaited<ReturnType<typeof requireProjectContext>>;

function hasServicePermission(
  context: ServiceContext,
  action: "view" | "create" | "update" | "delete" | "configure",
) {
  return checkPermissionWithContext("sre_service", action, {
    userId: context.userId,
    organizationId: context.organizationId,
    project: context.project,
  });
}

async function getScopedService(
  context: ServiceContext,
  serviceId: string,
) {
  return db.query.sreServices.findFirst({
    where: and(
      eq(sreServices.id, serviceId),
      eq(sreServices.organizationId, context.organizationId),
      eq(sreServices.projectId, context.project.id),
    ),
  });
}

async function validateActiveServiceIds(
  context: ServiceContext,
  serviceIds: string[],
) {
  const uniqueIds = [...new Set(serviceIds)];
  const rows = await db
    .select({ id: sreServices.id })
    .from(sreServices)
    .where(
      and(
        eq(sreServices.organizationId, context.organizationId),
        eq(sreServices.projectId, context.project.id),
        eq(sreServices.status, "active"),
        inArray(sreServices.id, uniqueIds),
      ),
    );

  return rows.length === uniqueIds.length;
}

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeService(row: typeof sreServices.$inferSelect): SreServiceListItem {
  const rawTags = row.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    environment: row.environment,
    ownerTeam: row.ownerTeam,
    repoUrl: row.repoUrl,
    otelServiceName: row.otelServiceName,
    slackChannel: row.slackChannel,
    status: row.status,
    tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function formatValidationErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened).filter(([, errors]) => errors && errors.length > 0)
  ) as Record<string, string[]>;
}

export async function getSreServices(): Promise<{
  success: true;
  services: SreServiceListItem[];
} | { success: false; error: string; services: [] }> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canView = checkPermissionWithContext("sre_service", "view", {
      userId,
      organizationId,
      project,
    });

    if (!canView) {
      return { success: false, error: "Insufficient permissions to view services", services: [] };
    }

    const services = await db
      .select()
      .from(sreServices)
      .where(
        and(
          eq(sreServices.organizationId, organizationId),
          eq(sreServices.projectId, project.id),
          ne(sreServices.status, "merged")
        )
      )
      .orderBy(desc(sreServices.updatedAt));

    return { success: true, services: services.map(normalizeService) };
  } catch (error) {
    logger.error({ error }, "Failed to fetch SRE services");
    return { success: false, error: "Failed to fetch services", services: [] };
  }
}

export async function createSreService(input: z.infer<typeof serviceInputSchema>): Promise<ServiceActionResult> {
  try {
    const parsed = serviceInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid service data",
        fieldErrors: formatValidationErrors(parsed.error),
      };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canCreate = checkPermissionWithContext("sre_service", "create", {
      userId,
      organizationId,
      project,
    });

    if (!canCreate) {
      return { success: false, error: "Insufficient permissions to create services" };
    }

    const existing = await db.query.sreServices.findFirst({
      where: and(
        eq(sreServices.organizationId, organizationId),
        eq(sreServices.projectId, project.id),
        eq(sreServices.name, parsed.data.name),
        eq(sreServices.status, "active")
      ),
      columns: { id: true },
    });

    if (existing) {
      return { success: false, error: "An active service with this name already exists" };
    }

    const [service] = await db
      .insert(sreServices)
      .values({
        organizationId,
        projectId: project.id,
        name: parsed.data.name,
        description: normalizeOptional(parsed.data.description),
        tier: parsed.data.tier,
        environment: normalizeOptional(parsed.data.environment),
        ownerTeam: normalizeOptional(parsed.data.ownerTeam),
        repoUrl: normalizeOptional(parsed.data.repoUrl),
        otelServiceName: normalizeOptional(parsed.data.otelServiceName),
        slackChannel: normalizeOptional(parsed.data.slackChannel),
        status: parsed.data.status,
        tags: parsed.data.tags,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_service_created",
      resource: "sre_service",
      resourceId: service.id,
      metadata: { projectId: project.id, serviceName: service.name },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service created" };
  } catch (error) {
    logger.error({ error }, "Failed to create SRE service");
    return { success: false, error: "Failed to create service" };
  }
}

export async function updateSreService(input: z.infer<typeof updateServiceInputSchema>): Promise<ServiceActionResult> {
  try {
    const parsed = updateServiceInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: "Invalid service data",
        fieldErrors: formatValidationErrors(parsed.error),
      };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canUpdate = checkPermissionWithContext("sre_service", "update", {
      userId,
      organizationId,
      project,
    });

    if (!canUpdate) {
      return { success: false, error: "Insufficient permissions to update services" };
    }

    const current = await db.query.sreServices.findFirst({
      where: and(
        eq(sreServices.id, parsed.data.id),
        eq(sreServices.organizationId, organizationId),
        eq(sreServices.projectId, project.id)
      ),
      columns: { id: true, name: true },
    });

    if (!current) {
      return { success: false, error: "Service not found or access denied" };
    }

    const duplicate = await db.query.sreServices.findFirst({
      where: and(
        eq(sreServices.organizationId, organizationId),
        eq(sreServices.projectId, project.id),
        eq(sreServices.name, parsed.data.name),
        eq(sreServices.status, "active"),
        ne(sreServices.id, parsed.data.id)
      ),
      columns: { id: true },
    });

    if (duplicate) {
      return { success: false, error: "Another active service with this name already exists" };
    }

    const [service] = await db
      .update(sreServices)
      .set({
        name: parsed.data.name,
        description: normalizeOptional(parsed.data.description),
        tier: parsed.data.tier,
        environment: normalizeOptional(parsed.data.environment),
        ownerTeam: normalizeOptional(parsed.data.ownerTeam),
        repoUrl: normalizeOptional(parsed.data.repoUrl),
        otelServiceName: normalizeOptional(parsed.data.otelServiceName),
        slackChannel: normalizeOptional(parsed.data.slackChannel),
        status: parsed.data.status,
        tags: parsed.data.tags,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sreServices.id, parsed.data.id),
          eq(sreServices.organizationId, organizationId),
          eq(sreServices.projectId, project.id)
        )
      )
      .returning();

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_service_updated",
      resource: "sre_service",
      resourceId: service.id,
      metadata: { projectId: project.id, previousName: current.name, serviceName: service.name },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service updated" };
  } catch (error) {
    logger.error({ error }, "Failed to update SRE service");
    return { success: false, error: "Failed to update service" };
  }
}

export async function archiveSreService(input: z.infer<typeof archiveServiceInputSchema>): Promise<ServiceActionResult> {
  try {
    const parsed = archiveServiceInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid service ID" };
    }

    const { userId, organizationId, project } = await requireProjectContext();
    const canDelete = checkPermissionWithContext("sre_service", "delete", {
      userId,
      organizationId,
      project,
    });

    if (!canDelete) {
      return { success: false, error: "Insufficient permissions to archive services" };
    }

    const service = await db.transaction(async (tx) => {
      const [archived] = await tx
        .update(sreServices)
        .set({ status: "deprecated", updatedAt: new Date() })
        .where(
          and(
            eq(sreServices.id, parsed.data.id),
            eq(sreServices.organizationId, organizationId),
            eq(sreServices.projectId, project.id),
          ),
        )
        .returning();

      if (archived) {
        await tx
          .update(sreServiceDependencies)
          .set({ status: "stale", lastSeenAt: new Date() })
          .where(
            and(
              eq(sreServiceDependencies.organizationId, organizationId),
              eq(sreServiceDependencies.projectId, project.id),
              eq(sreServiceDependencies.status, "active"),
              or(
                eq(sreServiceDependencies.sourceServiceId, archived.id),
                eq(sreServiceDependencies.targetServiceId, archived.id),
              ),
            ),
          );
      }

      return archived;
    });

    if (!service) {
      return { success: false, error: "Service not found or access denied" };
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_service_archived",
      resource: "sre_service",
      resourceId: service.id,
      metadata: { projectId: project.id, serviceName: service.name },
      success: true,
    });

    revalidatePath("/org-admin");
    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service archived" };
  } catch (error) {
    logger.error({ error }, "Failed to archive SRE service");
    return { success: false, error: "Failed to archive service" };
  }
}

function numericValue(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getResourceCandidates(
  context: ServiceContext,
): Promise<SreServiceResourceCandidate[]> {
  const [monitorRows, jobRows, testRows, componentRows, k6Rows] = await Promise.all([
    db
      .select({ id: monitors.id, name: monitors.name })
      .from(monitors)
      .where(and(eq(monitors.organizationId, context.organizationId), eq(monitors.projectId, context.project.id)))
      .orderBy(desc(monitors.updatedAt))
      .limit(200),
    db
      .select({ id: jobs.id, name: jobs.name })
      .from(jobs)
      .where(and(eq(jobs.organizationId, context.organizationId), eq(jobs.projectId, context.project.id)))
      .orderBy(desc(jobs.updatedAt))
      .limit(200),
    db
      .select({ id: tests.id, name: tests.title })
      .from(tests)
      .where(and(eq(tests.organizationId, context.organizationId), eq(tests.projectId, context.project.id)))
      .orderBy(desc(tests.updatedAt))
      .limit(200),
    db
      .select({ id: statusPageComponents.id, name: statusPageComponents.name })
      .from(statusPageComponents)
      .innerJoin(statusPages, eq(statusPageComponents.statusPageId, statusPages.id))
      .where(and(eq(statusPages.organizationId, context.organizationId), eq(statusPages.projectId, context.project.id)))
      .orderBy(desc(statusPageComponents.updatedAt))
      .limit(200),
    db
      .select({ id: k6PerformanceRuns.id, status: k6PerformanceRuns.status })
      .from(k6PerformanceRuns)
      .where(
        and(
          eq(k6PerformanceRuns.organizationId, context.organizationId),
          eq(k6PerformanceRuns.projectId, context.project.id),
        ),
      )
      .orderBy(desc(k6PerformanceRuns.createdAt))
      .limit(50),
  ]);

  return [
    ...monitorRows.map((row) => ({ ...row, type: "monitor" as const })),
    ...jobRows.map((row) => ({ ...row, type: "job" as const })),
    ...testRows.map((row) => ({ ...row, type: "test" as const })),
    ...componentRows.map((row) => ({ ...row, type: "status_page_component" as const })),
    ...k6Rows.map((row) => ({
      id: row.id,
      name: `k6 run ${row.id.slice(0, 8)} (${row.status})`,
      type: "k6_run" as const,
    })),
  ];
}

async function resourceBelongsToProject(
  context: ServiceContext,
  resourceType: z.infer<typeof resourceTypeSchema>,
  resourceId: string,
) {
  switch (resourceType) {
    case "monitor":
      return Boolean(await db.query.monitors.findFirst({
        where: and(
          eq(monitors.id, resourceId),
          eq(monitors.organizationId, context.organizationId),
          eq(monitors.projectId, context.project.id),
        ),
        columns: { id: true },
      }));
    case "job":
      return Boolean(await db.query.jobs.findFirst({
        where: and(
          eq(jobs.id, resourceId),
          eq(jobs.organizationId, context.organizationId),
          eq(jobs.projectId, context.project.id),
        ),
        columns: { id: true },
      }));
    case "test":
      return Boolean(await db.query.tests.findFirst({
        where: and(
          eq(tests.id, resourceId),
          eq(tests.organizationId, context.organizationId),
          eq(tests.projectId, context.project.id),
        ),
        columns: { id: true },
      }));
    case "status_page_component": {
      const [row] = await db
        .select({ id: statusPageComponents.id })
        .from(statusPageComponents)
        .innerJoin(statusPages, eq(statusPageComponents.statusPageId, statusPages.id))
        .where(
          and(
            eq(statusPageComponents.id, resourceId),
            eq(statusPages.organizationId, context.organizationId),
            eq(statusPages.projectId, context.project.id),
          ),
        )
        .limit(1);
      return Boolean(row);
    }
    case "k6_run":
      return Boolean(await db.query.k6PerformanceRuns.findFirst({
        where: and(
          eq(k6PerformanceRuns.id, resourceId),
          eq(k6PerformanceRuns.organizationId, context.organizationId),
          eq(k6PerformanceRuns.projectId, context.project.id),
        ),
        columns: { id: true },
      }));
  }
}

function buildHealthRollup(input: {
  snapshot: typeof sreServiceHealthSnapshots.$inferSelect | undefined;
  activeIncidents: number;
  firingAlerts: number;
  criticalIncidents: number;
  criticalAlerts: number;
  hasResources: boolean;
}): SreServiceHealthRollup {
  const calculatedAt = input.snapshot?.windowEnd ?? new Date();
  const stale = Boolean(input.snapshot && Date.now() - input.snapshot.windowEnd.getTime() > 15 * 60 * 1000);

  if (input.activeIncidents > 0 || input.firingAlerts > 0) {
    const failing = input.criticalIncidents > 0 || input.criticalAlerts > 0;
    return {
      health: failing ? "failing" : "degraded",
      score: failing ? 0 : 0.5,
      stale: false,
      calculatedAt: new Date(),
      explanation: `${input.activeIncidents} active incident${input.activeIncidents === 1 ? "" : "s"} and ${input.firingAlerts} firing alert${input.firingAlerts === 1 ? "" : "s"} are linked to this service${failing ? "; at least one is SEV1 or SEV2" : ""}.`,
      activeIncidentCount: input.activeIncidents,
      firingAlertCount: input.firingAlerts,
    };
  }

  if (input.snapshot && !stale) {
    return {
      health: input.snapshot.health,
      score: numericValue(input.snapshot.healthScore),
      stale: false,
      calculatedAt,
      explanation: "Latest service health snapshot; no active incident or firing alert overrides it.",
      activeIncidentCount: 0,
      firingAlertCount: 0,
    };
  }

  return {
    health: "unknown",
    score: null,
    stale,
    calculatedAt,
    explanation: stale
      ? "The latest health snapshot is stale and there are no current incident or alert signals."
      : input.hasResources
        ? "Linked resources have no recent health snapshot; no active incident or firing alert currently overrides this state."
        : "Link monitors, jobs, tests, or status components to calculate service health.",
    activeIncidentCount: 0,
    firingAlertCount: 0,
  };
}

export async function getSreServiceDetail(input: { id: string }): Promise<
  | { success: true; detail: SreServiceDetail }
  | { success: false; error: string; detail: null }
> {
  const parsed = archiveServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid service ID", detail: null };
  }

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "view")) {
      return { success: false, error: "Insufficient permissions to view service topology", detail: null };
    }

    const service = await getScopedService(context, parsed.data.id);
    if (!service) {
      return { success: false, error: "Service not found or access denied", detail: null };
    }

    const [
      serviceRows,
      dependencyRows,
      resourceRows,
      candidates,
      suggestionRows,
      snapshot,
      incidentRows,
      alertRows,
      deploymentRows,
    ] = await Promise.all([
      db
        .select({ id: sreServices.id, name: sreServices.name, status: sreServices.status })
        .from(sreServices)
        .where(
          and(
            eq(sreServices.organizationId, context.organizationId),
            eq(sreServices.projectId, context.project.id),
            ne(sreServices.status, "merged"),
          ),
        )
        .orderBy(sreServices.name),
      db
        .select()
        .from(sreServiceDependencies)
        .where(
          and(
            eq(sreServiceDependencies.organizationId, context.organizationId),
            eq(sreServiceDependencies.projectId, context.project.id),
            or(
              eq(sreServiceDependencies.sourceServiceId, service.id),
              eq(sreServiceDependencies.targetServiceId, service.id),
            ),
          ),
        )
        .orderBy(desc(sreServiceDependencies.lastSeenAt))
        .limit(200),
      db
        .select()
        .from(sreServiceResources)
        .where(eq(sreServiceResources.serviceId, service.id))
        .orderBy(desc(sreServiceResources.createdAt))
        .limit(200),
      getResourceCandidates(context),
      db
        .select()
        .from(sreServiceDiscoverySuggestions)
        .where(
          and(
            eq(sreServiceDiscoverySuggestions.organizationId, context.organizationId),
            eq(sreServiceDiscoverySuggestions.projectId, context.project.id),
            eq(sreServiceDiscoverySuggestions.suggestionType, "add_dependency"),
          ),
        )
        .orderBy(desc(sreServiceDiscoverySuggestions.createdAt))
        .limit(100),
      db.query.sreServiceHealthSnapshots.findFirst({
        where: and(
          eq(sreServiceHealthSnapshots.serviceId, service.id),
          eq(sreServiceHealthSnapshots.projectId, context.project.id),
        ),
        orderBy: [desc(sreServiceHealthSnapshots.windowEnd)],
      }),
      db
        .select({
          id: sreIncidents.id,
          incidentNumber: sreIncidents.incidentNumber,
          title: sreIncidents.title,
          severity: sreIncidents.severity,
          status: sreIncidents.status,
          updatedAt: sreIncidents.updatedAt,
        })
        .from(sreIncidents)
        .where(
          and(
            eq(sreIncidents.organizationId, context.organizationId),
            eq(sreIncidents.projectId, context.project.id),
            eq(sreIncidents.primaryServiceId, service.id),
          ),
        )
        .orderBy(desc(sreIncidents.updatedAt))
        .limit(20),
      db
        .select({
          id: sreAlertEvents.id,
          title: sreAlertEvents.title,
          severity: sreAlertEvents.severity,
          status: sreAlertEvents.status,
          firedAt: sreAlertEvents.firedAt,
        })
        .from(sreAlertEvents)
        .where(
          and(
            eq(sreAlertEvents.organizationId, context.organizationId),
            eq(sreAlertEvents.projectId, context.project.id),
            eq(sreAlertEvents.serviceId, service.id),
          ),
        )
        .orderBy(desc(sreAlertEvents.firedAt))
        .limit(20),
      db
        .select({
          id: sreServiceDeployments.id,
          source: sreServiceDeployments.source,
          commitSha: sreServiceDeployments.commitSha,
          commitMessage: sreServiceDeployments.commitMessage,
          deployedAt: sreServiceDeployments.deployedAt,
        })
        .from(sreServiceDeployments)
        .where(
          and(
            eq(sreServiceDeployments.serviceId, service.id),
            eq(sreServiceDeployments.projectId, context.project.id),
          ),
        )
        .orderBy(desc(sreServiceDeployments.deployedAt))
        .limit(20),
    ]);

    const serviceNames = new Map(serviceRows.map((row) => [row.id, row.name]));
    const candidateNames = new Map(candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate.name]));
    const dependencies = dependencyRows.map((row): SreServiceDependencyItem => ({
      id: row.id,
      sourceServiceId: row.sourceServiceId,
      sourceServiceName: serviceNames.get(row.sourceServiceId) ?? "Unavailable service",
      targetServiceId: row.targetServiceId,
      targetServiceName: serviceNames.get(row.targetServiceId) ?? "Unavailable service",
      source: row.source,
      sourceRef: row.sourceRef,
      confidence: numericValue(row.confidence),
      approvedAt: row.approvedAt,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      status: row.status,
    }));
    const resources = resourceRows.map((row): SreServiceResourceItem => ({
      id: row.id,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      resourceName: candidateNames.get(`${row.resourceType}:${row.resourceId}`) ?? "Unavailable resource",
      relationship: row.relationship,
      createdAt: row.createdAt,
    }));
    const suggestions = suggestionRows.flatMap((row): SreServiceSuggestionItem[] => {
      const data = dependencySuggestionDataSchema.safeParse(row.suggestionData);
      if (!data.success || (data.data.sourceServiceId !== service.id && data.data.targetServiceId !== service.id)) {
        return [];
      }
      return [{
        id: row.id,
        source: row.source,
        confidence: numericValue(row.confidence),
        sourceServiceId: data.data.sourceServiceId,
        sourceServiceName: serviceNames.get(data.data.sourceServiceId) ?? "Unavailable service",
        targetServiceId: data.data.targetServiceId,
        targetServiceName: serviceNames.get(data.data.targetServiceId) ?? "Unavailable service",
        status: row.status,
        createdAt: row.createdAt,
      }];
    });
    const [activeIncidentTotals, firingAlertTotals, criticalIncidentTotals, criticalAlertTotals] = await Promise.all([
      db
        .select({ total: count() })
        .from(sreIncidents)
        .where(
          and(
            eq(sreIncidents.organizationId, context.organizationId),
            eq(sreIncidents.projectId, context.project.id),
            eq(sreIncidents.primaryServiceId, service.id),
            ne(sreIncidents.status, "resolved"),
          ),
        ),
      db
        .select({ total: count() })
        .from(sreAlertEvents)
        .where(
          and(
            eq(sreAlertEvents.organizationId, context.organizationId),
            eq(sreAlertEvents.projectId, context.project.id),
            eq(sreAlertEvents.serviceId, service.id),
            eq(sreAlertEvents.status, "firing"),
          ),
        ),
      db
        .select({ total: count() })
        .from(sreIncidents)
        .where(
          and(
            eq(sreIncidents.organizationId, context.organizationId),
            eq(sreIncidents.projectId, context.project.id),
            eq(sreIncidents.primaryServiceId, service.id),
            ne(sreIncidents.status, "resolved"),
            inArray(sreIncidents.severity, ["sev1", "sev2"]),
          ),
        ),
      db
        .select({ total: count() })
        .from(sreAlertEvents)
        .where(
          and(
            eq(sreAlertEvents.organizationId, context.organizationId),
            eq(sreAlertEvents.projectId, context.project.id),
            eq(sreAlertEvents.serviceId, service.id),
            eq(sreAlertEvents.status, "firing"),
            inArray(sreAlertEvents.severity, ["sev1", "sev2"]),
          ),
        ),
    ]);
    const activeIncidentCount = activeIncidentTotals[0]?.total ?? 0;
    const firingAlertCount = firingAlertTotals[0]?.total ?? 0;

    return {
      success: true,
      detail: {
        service: normalizeService(service),
        services: serviceRows,
        dependencies,
        resources,
        resourceCandidates: candidates,
        suggestions,
        health: buildHealthRollup({
          snapshot,
          activeIncidents: activeIncidentCount,
          firingAlerts: firingAlertCount,
          criticalIncidents: criticalIncidentTotals[0]?.total ?? 0,
          criticalAlerts: criticalAlertTotals[0]?.total ?? 0,
          hasResources: resources.length > 0,
        }),
        recentIncidents: incidentRows,
        recentAlerts: alertRows,
        recentDeployments: deploymentRows,
        permissions: {
          canEdit: hasServicePermission(context, "update"),
          canConfigure: hasServicePermission(context, "configure"),
        },
      },
    };
  } catch (error) {
    logger.error({ error, serviceId: parsed.data.id }, "Failed to load SRE service detail");
    return { success: false, error: "Failed to load service topology", detail: null };
  }
}

export async function saveSreServiceDependency(
  input: z.infer<typeof dependencyInputSchema>,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const parsed = dependencyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid dependency" };
  }

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "update")) {
      return { success: false, error: "Insufficient permissions to manage service dependencies" };
    }
    if (!await validateActiveServiceIds(context, [parsed.data.sourceServiceId, parsed.data.targetServiceId])) {
      return { success: false, error: "Both dependency endpoints must be active services in the current project" };
    }

    let dependencyId: string;
    if (parsed.data.id) {
      const [updated] = await db
        .update(sreServiceDependencies)
        .set({
          sourceServiceId: parsed.data.sourceServiceId,
          targetServiceId: parsed.data.targetServiceId,
          source: "manual",
          sourceRef: null,
          confidence: "1",
          approvedBy: context.userId,
          approvedAt: new Date(),
          lastSeenAt: new Date(),
          status: "active",
        })
        .where(
          and(
            eq(sreServiceDependencies.id, parsed.data.id),
            eq(sreServiceDependencies.organizationId, context.organizationId),
            eq(sreServiceDependencies.projectId, context.project.id),
          ),
        )
        .returning({ id: sreServiceDependencies.id });
      if (!updated) return { success: false, error: "Dependency not found or access denied" };
      dependencyId = updated.id;
    } else {
      const [created] = await db
        .insert(sreServiceDependencies)
        .values({
          organizationId: context.organizationId,
          projectId: context.project.id,
          sourceServiceId: parsed.data.sourceServiceId,
          targetServiceId: parsed.data.targetServiceId,
          source: "manual",
          confidence: "1",
          approvedBy: context.userId,
          approvedAt: new Date(),
          status: "active",
        })
        .onConflictDoNothing()
        .returning({ id: sreServiceDependencies.id });
      if (!created) return { success: false, error: "An active dependency between these services already exists" };
      dependencyId = created.id;
    }

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: parsed.data.id ? "sre_service_dependency_updated" : "sre_service_dependency_created",
      resource: "sre_service_dependency",
      resourceId: dependencyId,
      metadata: {
        projectId: context.project.id,
        sourceServiceId: parsed.data.sourceServiceId,
        targetServiceId: parsed.data.targetServiceId,
      },
      success: true,
    });
    revalidatePath("/org-admin");
    revalidatePath(`/services/${parsed.data.sourceServiceId}`);
    return { success: true, message: parsed.data.id ? "Dependency updated" : "Dependency added" };
  } catch (error) {
    logger.error({ error }, "Failed to save SRE service dependency");
    return { success: false, error: "Failed to save dependency" };
  }
}

export async function removeSreServiceDependency(
  input: z.infer<typeof dependencyIdSchema>,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const parsed = dependencyIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid dependency ID" };

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "update")) {
      return { success: false, error: "Insufficient permissions to manage service dependencies" };
    }
    const [dependency] = await db
      .update(sreServiceDependencies)
      .set({ status: "rejected", lastSeenAt: new Date() })
      .where(
        and(
          eq(sreServiceDependencies.id, parsed.data.id),
          eq(sreServiceDependencies.organizationId, context.organizationId),
          eq(sreServiceDependencies.projectId, context.project.id),
        ),
      )
      .returning({
        id: sreServiceDependencies.id,
        sourceServiceId: sreServiceDependencies.sourceServiceId,
        targetServiceId: sreServiceDependencies.targetServiceId,
      });
    if (!dependency) return { success: false, error: "Dependency not found or access denied" };

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "sre_service_dependency_removed",
      resource: "sre_service_dependency",
      resourceId: dependency.id,
      metadata: { projectId: context.project.id, sourceServiceId: dependency.sourceServiceId, targetServiceId: dependency.targetServiceId },
      success: true,
    });
    revalidatePath("/org-admin");
    return { success: true, message: "Dependency removed from trusted topology" };
  } catch (error) {
    logger.error({ error, dependencyId: parsed.data.id }, "Failed to remove SRE service dependency");
    return { success: false, error: "Failed to remove dependency" };
  }
}

export async function addSreServiceResource(
  input: z.infer<typeof resourceInputSchema>,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const parsed = resourceInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid service resource" };

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "update")) {
      return { success: false, error: "Insufficient permissions to manage service resources" };
    }
    const service = await getScopedService(context, parsed.data.serviceId);
    if (!service || service.status !== "active") {
      return { success: false, error: "The service must be active and belong to the current project" };
    }
    if (!await resourceBelongsToProject(context, parsed.data.resourceType, parsed.data.resourceId)) {
      return { success: false, error: "Resource not found in the current project" };
    }

    const existingResource = await db.query.sreServiceResources.findFirst({
      where: and(
        eq(sreServiceResources.serviceId, parsed.data.serviceId),
        eq(sreServiceResources.resourceType, parsed.data.resourceType),
        eq(sreServiceResources.resourceId, parsed.data.resourceId),
      ),
      columns: { id: true, relationship: true },
    });
    const [resource] = existingResource
      ? await db
          .update(sreServiceResources)
          .set({ relationship: parsed.data.relationship })
          .where(
            and(
              eq(sreServiceResources.id, existingResource.id),
              eq(sreServiceResources.serviceId, service.id),
            ),
          )
          .returning({ id: sreServiceResources.id })
      : await db
          .insert(sreServiceResources)
          .values(parsed.data)
          .returning({ id: sreServiceResources.id });
    if (!resource) return { success: false, error: "Failed to save resource link" };

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: existingResource ? "sre_service_resource_updated" : "sre_service_resource_added",
      resource: "sre_service_resource",
      resourceId: resource.id,
      metadata: {
        projectId: context.project.id,
        serviceId: parsed.data.serviceId,
        resourceType: parsed.data.resourceType,
        resourceId: parsed.data.resourceId,
        relationship: parsed.data.relationship,
      },
      success: true,
    });
    revalidatePath("/org-admin");
    revalidatePath(`/services/${parsed.data.serviceId}`);
    return { success: true, message: existingResource ? "Resource link updated" : "Resource linked" };
  } catch (error) {
    logger.error({ error }, "Failed to link SRE service resource");
    return { success: false, error: "Failed to link resource" };
  }
}

export async function removeSreServiceResource(
  input: z.infer<typeof resourceIdSchema>,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const parsed = resourceIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid service resource" };

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "update")) {
      return { success: false, error: "Insufficient permissions to manage service resources" };
    }
    const service = await getScopedService(context, parsed.data.serviceId);
    if (!service) return { success: false, error: "Service not found or access denied" };

    const [resource] = await db
      .delete(sreServiceResources)
      .where(and(eq(sreServiceResources.id, parsed.data.id), eq(sreServiceResources.serviceId, service.id)))
      .returning({ id: sreServiceResources.id, resourceType: sreServiceResources.resourceType, resourceId: sreServiceResources.resourceId });
    if (!resource) return { success: false, error: "Resource link not found" };

    await logAuditEvent({
      userId: context.userId,
      organizationId: context.organizationId,
      action: "sre_service_resource_removed",
      resource: "sre_service_resource",
      resourceId: resource.id,
      metadata: { projectId: context.project.id, serviceId: service.id, resourceType: resource.resourceType, resourceId: resource.resourceId },
      success: true,
    });
    revalidatePath("/org-admin");
    revalidatePath(`/services/${service.id}`);
    return { success: true, message: "Resource unlinked" };
  } catch (error) {
    logger.error({ error }, "Failed to remove SRE service resource");
    return { success: false, error: "Failed to unlink resource" };
  }
}

async function decideDependencySuggestion(
  input: z.infer<typeof suggestionDecisionSchema>,
  decision: "approved" | "rejected",
): Promise<{ success: boolean; error?: string; message?: string }> {
  const parsed = suggestionDecisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid suggestion ID" };

  try {
    const context = await requireProjectContext();
    if (!hasServicePermission(context, "configure")) {
      return { success: false, error: "Insufficient permissions to approve topology suggestions" };
    }

    const outcome = await db.transaction(async (tx) => {
      const suggestion = await tx.query.sreServiceDiscoverySuggestions.findFirst({
        where: and(
          eq(sreServiceDiscoverySuggestions.id, parsed.data.id),
          eq(sreServiceDiscoverySuggestions.organizationId, context.organizationId),
          eq(sreServiceDiscoverySuggestions.projectId, context.project.id),
          eq(sreServiceDiscoverySuggestions.suggestionType, "add_dependency"),
        ),
      });
      if (!suggestion) return { error: "Suggestion not found or access denied" } as const;
      if (suggestion.status === decision) return { suggestion, unchanged: true } as const;
      if (suggestion.status !== "pending") return { error: "This suggestion has already been decided" } as const;

      if (decision === "approved") {
        const suggestionData = dependencySuggestionDataSchema.safeParse(suggestion.suggestionData);
        if (!suggestionData.success) return { error: "Suggestion data is invalid and cannot be approved" } as const;
        const validServices = await tx
          .select({ id: sreServices.id })
          .from(sreServices)
          .where(
            and(
              eq(sreServices.organizationId, context.organizationId),
              eq(sreServices.projectId, context.project.id),
              eq(sreServices.status, "active"),
              inArray(sreServices.id, [suggestionData.data.sourceServiceId, suggestionData.data.targetServiceId]),
            ),
          );
        if (validServices.length !== 2) return { error: "Both suggested services must still be active in the current project" } as const;

        await tx
          .insert(sreServiceDependencies)
          .values({
            organizationId: context.organizationId,
            projectId: context.project.id,
            sourceServiceId: suggestionData.data.sourceServiceId,
            targetServiceId: suggestionData.data.targetServiceId,
            source: "ai_suggested",
            sourceRef: suggestionData.data.sourceRef ?? suggestion.id,
            confidence: suggestion.confidence,
            approvedBy: context.userId,
            approvedAt: new Date(),
            status: "active",
          })
          .onConflictDoNothing();
      }

      const [updated] = await tx
        .update(sreServiceDiscoverySuggestions)
        .set({
          status: decision,
          approvedBy: decision === "approved" ? context.userId : null,
          approvedAt: decision === "approved" ? new Date() : null,
        })
        .where(
          and(
            eq(sreServiceDiscoverySuggestions.id, suggestion.id),
            eq(sreServiceDiscoverySuggestions.status, "pending"),
          ),
        )
        .returning();
      if (!updated) return { error: "This suggestion was decided by another responder" } as const;
      return { suggestion: updated, unchanged: false } as const;
    });

    if ("error" in outcome) return { success: false, error: outcome.error };
    if (!outcome.unchanged) {
      await logAuditEvent({
        userId: context.userId,
        organizationId: context.organizationId,
        action: decision === "approved" ? "sre_topology_suggestion_approved" : "sre_topology_suggestion_rejected",
        resource: "sre_service_discovery_suggestion",
        resourceId: outcome.suggestion.id,
        metadata: { projectId: context.project.id, suggestionType: outcome.suggestion.suggestionType, source: outcome.suggestion.source },
        success: true,
      });
    }
    revalidatePath("/org-admin");
    revalidatePath("/copilot/evidence-graph");
    return { success: true, message: decision === "approved" ? "Suggestion approved" : "Suggestion rejected" };
  } catch (error) {
    logger.error({ error, suggestionId: parsed.data.id, decision }, "Failed to decide SRE topology suggestion");
    return { success: false, error: "Failed to update suggestion" };
  }
}

export async function approveSreTopologySuggestion(input: z.infer<typeof suggestionDecisionSchema>) {
  return decideDependencySuggestion(input, "approved");
}

export async function rejectSreTopologySuggestion(input: z.infer<typeof suggestionDecisionSchema>) {
  return decideDependencySuggestion(input, "rejected");
}
