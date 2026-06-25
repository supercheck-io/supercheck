"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/utils/db";
import { sreServices } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";

const serviceTierSchema = z.enum(["1", "2", "3", "4"]);
const serviceStatusSchema = z.enum(["active", "deprecated", "merged"]);

const serviceInputSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  tier: serviceTierSchema.default("3"),
  environment: z.string().trim().max(50).optional().nullable(),
  ownerTeam: z.string().trim().max(100).optional().nullable(),
  repoUrl: z.string().trim().url("Enter a valid repository URL").optional().or(z.literal("")),
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
    console.error("Error fetching SRE services:", error);
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

    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service created" };
  } catch (error) {
    console.error("Error creating SRE service:", error);
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

    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service updated" };
  } catch (error) {
    console.error("Error updating SRE service:", error);
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

    const [service] = await db
      .update(sreServices)
      .set({ status: "deprecated", updatedAt: new Date() })
      .where(
        and(
          eq(sreServices.id, parsed.data.id),
          eq(sreServices.organizationId, organizationId),
          eq(sreServices.projectId, project.id)
        )
      )
      .returning();

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

    revalidatePath("/services");
    return { success: true, service: normalizeService(service), message: "Service archived" };
  } catch (error) {
    console.error("Error archiving SRE service:", error);
    return { success: false, error: "Failed to archive service" };
  }
}
