/**
 * Status page service.
 *
 * Single implementation shared by the server actions (dashboard UI) and the
 * REST routes (CLI / API). Permission checks and cache revalidation stay in
 * the callers; everything else (validation, plan and feature gating,
 * custom-domain rules, cross-project checks, aggregation, audit logging)
 * lives here so both paths behave identically.
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import {
  monitors,
  sreServices,
  statusPageComponentMonitors,
  statusPageComponents,
  statusPages,
} from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { checkStatusPageLimit, checkFeatureAvailability } from "@/lib/middleware/plan-enforcement";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";
import { statusAggregationService } from "@/lib/status-aggregation.service";
import {
  getEffectiveStatusPageCnameTarget,
  getEffectiveStatusPageDomain,
  getStatusPageCustomDomainConfigError,
  isReservedStatusPageHostname,
} from "@/lib/status-page-domain";
import {
  normalizeStatusPageSupportContact,
  statusPageSupportContactSchema,
} from "@/lib/status-page-support";
import {
  subscriptionService,
  SubscriptionAccessDeniedError,
} from "@/lib/services/subscription-service";
import { generateProxyUrl } from "@/lib/asset-proxy";

export interface StatusPageServiceContext {
  userId: string;
  organizationId: string;
  projectId: string;
  /** Used only for audit metadata. */
  projectName?: string;
}

export type ServiceErrorCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "busy"
  | "internal";

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceErrorCode; message: string };

const fail = (code: ServiceErrorCode, message: string): { ok: false; code: ServiceErrorCode; message: string } => ({
  ok: false,
  code,
  message,
});

/** HTTP status for a service error code. */
export function httpStatusForServiceError(code: ServiceErrorCode): number {
  switch (code) {
    case "validation":
      return 400;
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "conflict":
      return 409;
    case "busy":
      return 429;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createStatusPageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  headline: z.string().max(255).optional(),
  pageDescription: z.string().max(2000, "Description too long").optional(),
});

export type CreateStatusPageInput = z.infer<typeof createStatusPageSchema>;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional();

/** Settings fields (everything the settings form can change, without the page id). */
export const statusPageSettingsFieldsSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name too long").trim().optional(),
  headline: z.string().max(255, "Headline too long").trim().optional(),
  pageDescription: z.string().max(2000, "Description too long").trim().optional(),
  supportUrl: statusPageSupportContactSchema.optional(),
  timezone: z.string().max(50).optional(),

  // Language for public status page (ISO 639-1 code)
  language: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Invalid language code")
    .optional(),

  // Custom domain with strict validation
  customDomain: z
    .string()
    .max(255)
    .regex(
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      "Invalid domain format"
    )
    .transform((val) => val?.toLowerCase().trim())
    .optional()
    .or(z.literal("")),

  // Subscriber settings
  allowPageSubscribers: z.boolean().optional(),
  allowEmailSubscribers: z.boolean().optional(),
  allowWebhookSubscribers: z.boolean().optional(),
  allowSlackSubscribers: z.boolean().optional(),
  allowIncidentSubscribers: z.boolean().optional(),
  allowRssFeed: z.boolean().optional(),

  // Branding colors (hex codes)
  cssBodyBackgroundColor: hexColor,
  cssFontColor: hexColor,
  cssLightFontColor: hexColor,
  cssGreens: hexColor,
  cssYellows: hexColor,
  cssOranges: hexColor,
  cssBlues: hexColor,
  cssReds: hexColor,
  cssBorderColor: hexColor,
  cssGraphColor: hexColor,
  cssLinkColor: hexColor,
  cssNoData: hexColor,
});

export type StatusPageSettingsInput = z.infer<typeof statusPageSettingsFieldsSchema>;

const componentStatusEnum = z.enum([
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
  "under_maintenance",
]);
const aggregationMethodEnum = z.enum(["worst_case", "best_case", "weighted_average", "majority_vote"]);
/** Same monitor can be listed twice by a client; collapse before the ownership check so it is not "not found". */
const monitorIdList = z
  .array(z.string().uuid())
  .max(100, "A component can link at most 100 monitors")
  .transform((ids) => Array.from(new Set(ids)));
const monitorWeightMap = z
  .record(z.string().uuid(), z.number().int().min(1).max(100))
  .refine((weights) => Object.keys(weights).length <= 100, "At most 100 monitor weights");
const componentName = z.string().trim().min(1, "Name is required").max(255, "Name is too long");

export const createComponentFieldsSchema = z.object({
  name: componentName,
  description: z.string().max(2000, "Description is too long").optional(),
  monitorIds: monitorIdList.optional(),
  status: componentStatusEnum.default("operational"),
  showcase: z.boolean().default(true),
  onlyShowIfDegraded: z.boolean().default(false),
  position: z.number().int().min(0).max(1000).default(0),
  aggregationMethod: aggregationMethodEnum.default("worst_case"),
  autoCreateIncidents: z.boolean().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  monitorWeights: monitorWeightMap.optional(),
  failureThreshold: z.number().int().min(1).max(100).default(1),
});

export const updateComponentFieldsSchema = z.object({
  name: componentName.optional(),
  description: z.string().max(2000, "Description is too long").optional().nullable(),
  monitorIds: monitorIdList.optional(),
  status: componentStatusEnum.optional(),
  showcase: z.boolean().optional(),
  onlyShowIfDegraded: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  aggregationMethod: aggregationMethodEnum.optional(),
  autoCreateIncidents: z.boolean().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  monitorWeights: monitorWeightMap.optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
});

export type CreateComponentInput = z.input<typeof createComponentFieldsSchema>;
export type UpdateComponentInput = z.input<typeof updateComponentFieldsSchema>;

/** Fields that only the server may set; REST callers sending them get a 400. */
export const SERVER_MANAGED_STATUS_PAGE_KEYS = ["subdomain", "customDomainVerified"] as const;

/** Returns an error message when the body tries to set a server-managed field, else null. */
export function findServerManagedKeyError(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const present = SERVER_MANAGED_STATUS_PAGE_KEYS.filter((key) => key in (body as object));
  if (present.length === 0) return null;
  return `${present.join(", ")} cannot be set by clients; ${present.length > 1 ? "they are" : "it is"} managed by the server`;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type StatusPageRow = typeof statusPages.$inferSelect;
type ComponentRow = typeof statusPageComponents.$inferSelect;

/** Same shape the GET /api/status-pages/[id] route returns for `statusPage`. */
export function toStatusPageDto(row: StatusPageRow) {
  return {
    ...row,
    faviconLogo: generateProxyUrl(row.faviconLogo),
    transactionalLogo: generateProxyUrl(row.transactionalLogo),
    heroCover: generateProxyUrl(row.heroCover),
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export interface ComponentDto {
  id: string;
  name: string;
  description: string | null;
  position: number;
  monitorIds: string[];
  status: ComponentRow["status"];
  showcase: boolean | null;
  onlyShowIfDegraded: boolean | null;
  aggregationMethod: string;
  failureThreshold: number;
  autoCreateIncidents: boolean;
  serviceId: string | null;
}

export function toComponentDto(row: ComponentRow, monitorIds: string[]): ComponentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    position: row.position ?? 0,
    monitorIds,
    status: row.status,
    showcase: row.showcase,
    onlyShowIfDegraded: row.onlyShowIfDegraded,
    aggregationMethod: row.aggregationMethod,
    failureThreshold: row.failureThreshold,
    autoCreateIncidents: row.autoCreateIncidents,
    serviceId: row.serviceId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const firstIssue = (error: z.ZodError, fallback = "Invalid data provided") =>
  error.issues[0]?.message || fallback;

async function findOwnedStatusPage(ctx: StatusPageServiceContext, statusPageId: string) {
  return db.query.statusPages.findFirst({
    where: and(
      eq(statusPages.id, statusPageId),
      eq(statusPages.organizationId, ctx.organizationId),
      eq(statusPages.projectId, ctx.projectId)
    ),
  });
}

async function monitorIdsForComponent(componentId: string): Promise<string[]> {
  const links = await db
    .select({ monitorId: statusPageComponentMonitors.monitorId })
    .from(statusPageComponentMonitors)
    .where(eq(statusPageComponentMonitors.componentId, componentId));
  return links.map((l) => l.monitorId);
}

/** Verifies monitors and the optional service belong to the caller's project. */
async function verifyComponentReferences(
  ctx: StatusPageServiceContext,
  monitorIds: string[] | undefined,
  serviceId: string | null | undefined
): Promise<ServiceResult<null>> {
  if (monitorIds && monitorIds.length > 0) {
    const validMonitors = await db
      .select({ id: monitors.id })
      .from(monitors)
      .where(and(inArray(monitors.id, monitorIds), eq(monitors.projectId, ctx.projectId)));

    if (validMonitors.length !== monitorIds.length) {
      return fail("validation", "One or more monitors not found or access denied");
    }
  }

  if (serviceId) {
    const service = await db.query.sreServices.findFirst({
      where: and(
        eq(sreServices.id, serviceId),
        eq(sreServices.organizationId, ctx.organizationId),
        eq(sreServices.projectId, ctx.projectId)
      ),
    });
    if (!service) return fail("validation", "Service not found or access denied");
  }

  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Status pages
// ---------------------------------------------------------------------------

export async function createStatusPage(
  ctx: StatusPageServiceContext,
  input: unknown
): Promise<ServiceResult<{ statusPage: StatusPageRow }>> {
  const parsed = createStatusPageSchema.safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid data provided");
  const validatedData = parsed.data;
  const { userId, organizationId, projectId } = ctx;

  // Subdomain is always server-generated; it is never accepted from a client.
  const subdomain = randomUUID().replace(/-/g, "");

  try {
    const outcome = await insertWithinPlanLimit({
      organizationId,
      resource: "status_pages",
      check: checkStatusPageLimit,
      countRows: async (tx) => {
        const [row] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(statusPages)
          .where(eq(statusPages.organizationId, organizationId));
        return Number(row?.count || 0);
      },
      insert: async (executor) => {
        const [created] = await executor
          .insert(statusPages)
          .values({
            organizationId,
            projectId,
            name: validatedData.name,
            subdomain,
            headline: validatedData.headline || null,
            pageDescription: validatedData.pageDescription || null,
            status: "draft",
            createdByUserId: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        return created;
      },
    });

    if (!outcome.ok && outcome.busy) {
      return fail("busy", "Too many concurrent requests. Please retry shortly.");
    }
    if (!outcome.ok) {
      console.warn(`Status page limit reached for organization ${organizationId}: ${outcome.check.error}`);
      return fail("forbidden", outcome.check.error ?? "Status page limit reached");
    }
    const statusPage = outcome.row;

    await logAuditEvent({
      userId,
      action: "status_page_created",
      resource: "status_page",
      resourceId: statusPage.id,
      metadata: {
        organizationId,
        statusPageName: validatedData.name,
        projectId,
        projectName: ctx.projectName,
        subdomain: statusPage.subdomain,
      },
      success: true,
    });

    return { ok: true, data: { statusPage } };
  } catch (dbError) {
    // Details stay in the server log; the client never sees raw database text.
    console.error("Error creating status page:", dbError);
    return fail("internal", "Failed to create status page. Please try again.");
  }
}

export async function updateStatusPageSettings(
  ctx: StatusPageServiceContext,
  statusPageId: string,
  input: unknown
): Promise<ServiceResult<null>> {
  const { userId, organizationId, projectId } = ctx;
  try {
    if (!z.string().uuid("Invalid status page ID").safeParse(statusPageId).success) {
      return fail("validation", "Invalid status page ID");
    }
    const parsed = statusPageSettingsFieldsSchema.safeParse(input);
    if (!parsed.success) return fail("validation", firstIssue(parsed.error, "Invalid input data"));
    const settings = parsed.data;

    // SECURITY: Verify status page belongs to this organization AND project
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update status page ${statusPageId} without ownership`
      );
      return fail("not_found", "Status page not found or access denied");
    }

    const updatePayload: Record<string, unknown> = {
      ...settings,
      updatedAt: new Date(),
    };

    // If custom domain is being changed, reset verification status
    if (settings.customDomain !== undefined && settings.customDomain !== statusPage.customDomain) {
      updatePayload.customDomainVerified = false;
      updatePayload.customDomainFailureCount = 0;

      if (settings.customDomain) {
        const availability = await checkFeatureAvailability(organizationId, "customDomains");
        if (!availability.available) {
          return fail("forbidden", availability.error ?? "Custom domains are not available on your plan.");
        }
        const customDomainConfigError = getStatusPageCustomDomainConfigError();
        if (customDomainConfigError) {
          return fail("validation", customDomainConfigError);
        }

        const baseDomain = getEffectiveStatusPageDomain();
        const customDomainCnameTarget = getEffectiveStatusPageCnameTarget();
        if (isReservedStatusPageHostname(settings.customDomain, baseDomain)) {
          return fail(
            "validation",
            `Custom domain cannot use ${baseDomain} or its subdomains. Use a separate hostname and point its CNAME to ${customDomainCnameTarget}.`
          );
        }

        const existingDomain = await db.query.statusPages.findFirst({
          where: and(
            eq(statusPages.customDomain, settings.customDomain),
            ne(statusPages.id, statusPageId)
          ),
          columns: { id: true },
        });
        if (existingDomain) {
          return fail("conflict", "This custom domain is already in use by another status page");
        }
      }
    }

    // Normalize empty values to null for proper DB storage (unique constraint compatibility)
    if (updatePayload.customDomain === "") updatePayload.customDomain = null;
    if (updatePayload.headline === "") updatePayload.headline = null;
    if (updatePayload.pageDescription === "") updatePayload.pageDescription = null;

    if (settings.supportUrl !== undefined) {
      updatePayload.supportUrl = normalizeStatusPageSupportContact(settings.supportUrl);
    }

    await db
      .update(statusPages)
      .set(updatePayload)
      .where(
        and(
          eq(statusPages.id, statusPageId),
          eq(statusPages.organizationId, organizationId),
          eq(statusPages.projectId, projectId)
        )
      );

    await logAuditEvent({
      userId,
      action: "status_page_settings_updated",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        projectId,
        changedFields: Object.keys(settings),
      },
      success: true,
    });

    return { ok: true, data: null };
  } catch (error) {
    console.error("Error updating status page settings:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return fail("conflict", "This custom domain is already in use by another status page");
    }

    return fail("internal", "Failed to update settings. Please try again.");
  }
}

export type StatusPageTargetStatus = "published" | "draft" | "archived";

/**
 * Everything that must hold before a page can go live: an active subscription, ownership and at least one
 * public component. Read-only, so callers can run it before applying any other change.
 */
export async function checkPublishPreconditions(
  ctx: StatusPageServiceContext,
  statusPageId: string
): Promise<ServiceResult<{ statusPage: StatusPageRow }>> {
  const { userId, organizationId } = ctx;
  try {
    if (!z.string().uuid().safeParse(statusPageId).success) {
      return fail("validation", "Invalid status page ID");
    }

    // An expired trial or lapsed subscription must not bring an archived page back online.
    try {
      await subscriptionService.blockUntilSubscribed(organizationId);
      await subscriptionService.requireValidPolarCustomer(organizationId);
    } catch (error) {
      // SubscriptionAccessDeniedError messages are written for end users; anything else is internal.
      if (error instanceof SubscriptionAccessDeniedError) {
        return fail("forbidden", error.message);
      }
      throw error;
    }

    // SECURITY: Verify ownership
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to publish status page ${statusPageId} without ownership`
      );
      return fail("not_found", "Status page not found or access denied");
    }

    const visibleComponent = await db.query.statusPageComponents.findFirst({
      where: and(eq(statusPageComponents.statusPageId, statusPageId), eq(statusPageComponents.showcase, true)),
      columns: { id: true },
    });
    if (!visibleComponent) {
      return fail("validation", "Add at least one public component before publishing.");
    }
    return { ok: true, data: { statusPage } };
  } catch (error) {
    console.error("Error checking publish preconditions:", error);
    return fail("internal", "Failed to publish status page. Please try again.");
  }
}

/**
 * Publish, unpublish (draft) or archive a status page.
 * "draft" and "archived" both go through the unpublish path.
 */
export async function setStatusPagePublished(
  ctx: StatusPageServiceContext,
  statusPageId: string,
  target: StatusPageTargetStatus
): Promise<ServiceResult<{ statusPage: StatusPageRow }>> {
  const { userId, organizationId, projectId } = ctx;
  const publishing = target === "published";
  const verb = publishing ? "publish" : "unpublish";

  try {
    if (!z.string().uuid().safeParse(statusPageId).success) {
      return fail("validation", "Invalid status page ID");
    }

    if (publishing) {
      const preconditions = await checkPublishPreconditions(ctx, statusPageId);
      if (!preconditions.ok) return preconditions;
    } else {
      // SECURITY: Verify ownership
      const statusPage = await findOwnedStatusPage(ctx, statusPageId);
      if (!statusPage) {
        console.warn(
          `[SECURITY] User ${userId} attempted to ${verb} status page ${statusPageId} without ownership`
        );
        return fail("not_found", "Status page not found or access denied");
      }
    }

    const [updatedStatusPage] = await db
      .update(statusPages)
      .set({ status: target, updatedAt: new Date() })
      .where(and(eq(statusPages.id, statusPageId), eq(statusPages.organizationId, organizationId)))
      .returning();

    if (!updatedStatusPage) {
      return fail("internal", `Failed to ${verb} status page`);
    }

    await logAuditEvent({
      userId,
      action: publishing
        ? "status_page_published"
        : target === "archived"
          ? "status_page_archived"
          : "status_page_unpublished",
      resource: "status_page",
      resourceId: statusPageId,
      metadata: {
        organizationId,
        statusPageName: updatedStatusPage.name,
        subdomain: updatedStatusPage.subdomain,
        projectId,
        projectName: ctx.projectName,
      },
      success: true,
    });

    return { ok: true, data: { statusPage: updatedStatusPage } };
  } catch (error) {
    console.error(`Error ${verb}ing status page:`, error);
    return fail("internal", `Failed to ${verb} status page. Please try again.`);
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export async function listComponents(
  ctx: StatusPageServiceContext,
  statusPageId: string
): Promise<ServiceResult<{ components: ComponentDto[] }>> {
  try {
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) return fail("not_found", "Status page not found or access denied");

    const rows = await db.query.statusPageComponents.findMany({
      where: eq(statusPageComponents.statusPageId, statusPageId),
      orderBy: [asc(statusPageComponents.position), asc(statusPageComponents.createdAt)],
      with: { monitors: { columns: { monitorId: true } } },
    });

    return {
      ok: true,
      data: {
        components: rows.map((row) => toComponentDto(row, row.monitors.map((m) => m.monitorId))),
      },
    };
  } catch (error) {
    console.error("Error listing components:", error);
    return fail("internal", "Failed to list components. Please try again.");
  }
}

export async function createComponent(
  ctx: StatusPageServiceContext,
  statusPageId: string,
  input: CreateComponentInput
): Promise<ServiceResult<{ component: ComponentRow; monitorIds: string[] }>> {
  const { userId, organizationId, projectId } = ctx;
  try {
    if (!z.string().uuid().safeParse(statusPageId).success) {
      return fail("validation", "Invalid status page ID");
    }
    const parsed = createComponentFieldsSchema.safeParse(input);
    if (!parsed.success) return fail("validation", firstIssue(parsed.error));
    const validatedData = parsed.data;

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to create component for status page ${statusPageId} without ownership`
      );
      return fail("not_found", "Status page not found or access denied");
    }

    const refs = await verifyComponentReferences(ctx, validatedData.monitorIds, validatedData.serviceId);
    if (!refs.ok) return refs;

    const monitorIds = validatedData.monitorIds ?? [];
    // The row and its monitor links commit together, so a failed link never leaves a component behind.
    let component = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(statusPageComponents)
        .values({
          statusPageId,
          name: validatedData.name,
          description: validatedData.description || null,
          status: validatedData.status,
          showcase: validatedData.showcase,
          onlyShowIfDegraded: validatedData.onlyShowIfDegraded,
          position: validatedData.position,
          aggregationMethod: validatedData.aggregationMethod,
          failureThreshold: validatedData.failureThreshold,
          autoCreateIncidents: validatedData.autoCreateIncidents ?? false,
          serviceId: validatedData.serviceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (monitorIds.length > 0) {
        await tx.insert(statusPageComponentMonitors).values(
          monitorIds.map((monitorId) => ({
            componentId: created.id,
            monitorId,
            weight: validatedData.monitorWeights?.[monitorId] ?? 1,
            createdAt: new Date(),
          }))
        );
      }
      return created;
    });

    if (monitorIds.length > 0) {
      // If caller didn't explicitly set status, derive from linked monitor statuses
      if (input.status === undefined) {
        await statusAggregationService.updateComponentStatus(component.id);
        const refreshed = await db.query.statusPageComponents.findFirst({
          where: eq(statusPageComponents.id, component.id),
        });
        if (refreshed) component = refreshed;
      }
    }

    await logAuditEvent({
      userId,
      action: "component_created",
      resource: "status_page_component",
      resourceId: component.id,
      metadata: {
        organizationId,
        componentName: validatedData.name,
        statusPageId,
        projectId,
        projectName: ctx.projectName,
        monitorIds: validatedData.monitorIds,
        aggregationMethod: validatedData.aggregationMethod,
        failureThreshold: validatedData.failureThreshold,
      },
      success: true,
    });

    return { ok: true, data: { component, monitorIds } };
  } catch (error) {
    console.error("Error creating component:", error);
    return fail("internal", "Failed to create component. Please try again.");
  }
}

export async function updateComponent(
  ctx: StatusPageServiceContext,
  statusPageId: string,
  componentId: string,
  input: UpdateComponentInput
): Promise<ServiceResult<{ component: ComponentRow; monitorIds: string[] }>> {
  const { userId, organizationId, projectId } = ctx;
  try {
    const ids = z.object({ a: z.string().uuid(), b: z.string().uuid() }).safeParse({
      a: statusPageId,
      b: componentId,
    });
    if (!ids.success) return fail("validation", "Invalid ID format");
    const parsed = updateComponentFieldsSchema.safeParse(input);
    if (!parsed.success) return fail("validation", firstIssue(parsed.error));
    const validatedData = parsed.data;

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to update component for status page ${statusPageId} without ownership`
      );
      return fail("not_found", "Status page not found or access denied");
    }

    const existingComponent = await db.query.statusPageComponents.findFirst({
      where: and(
        eq(statusPageComponents.id, componentId),
        eq(statusPageComponents.statusPageId, statusPageId)
      ),
    });
    if (!existingComponent) return fail("not_found", "Component not found or access denied");

    const refs = await verifyComponentReferences(ctx, validatedData.monitorIds, validatedData.serviceId);
    if (!refs.ok) return refs;

    // Build update object with only provided fields
    const updateData: Partial<typeof statusPageComponents.$inferInsert> = { updatedAt: new Date() };
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.description !== undefined) updateData.description = validatedData.description;
    if (validatedData.status !== undefined) updateData.status = validatedData.status;
    if (validatedData.showcase !== undefined) updateData.showcase = validatedData.showcase;
    if (validatedData.onlyShowIfDegraded !== undefined)
      updateData.onlyShowIfDegraded = validatedData.onlyShowIfDegraded;
    if (validatedData.position !== undefined) updateData.position = validatedData.position;
    if (validatedData.aggregationMethod !== undefined)
      updateData.aggregationMethod = validatedData.aggregationMethod;
    if (validatedData.failureThreshold !== undefined)
      updateData.failureThreshold = validatedData.failureThreshold;
    if (validatedData.autoCreateIncidents !== undefined)
      updateData.autoCreateIncidents = validatedData.autoCreateIncidents;
    if (validatedData.serviceId !== undefined) updateData.serviceId = validatedData.serviceId;

    // Row update and link replacement commit together, so a failed insert cannot leave a half-applied component.
    const linkedMonitorIds = validatedData.monitorIds;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(statusPageComponents)
        .set(updateData)
        .where(
          and(
            eq(statusPageComponents.id, componentId),
            eq(statusPageComponents.statusPageId, statusPageId)
          )
        )
        .returning();
      if (linkedMonitorIds !== undefined) {
        await tx
          .delete(statusPageComponentMonitors)
          .where(eq(statusPageComponentMonitors.componentId, componentId));
        if (linkedMonitorIds.length > 0) {
          await tx.insert(statusPageComponentMonitors).values(
            linkedMonitorIds.map((monitorId) => ({
              componentId,
              monitorId,
              weight: validatedData.monitorWeights?.[monitorId] ?? 1,
              createdAt: new Date(),
            }))
          );
        }
      }
      return row;
    });
    let component = updated;

    if (linkedMonitorIds !== undefined) {

      if (linkedMonitorIds.length > 0) {

        // Preserve explicit manual status updates; only aggregate when status not provided
        if (validatedData.status === undefined) {
          await statusAggregationService.updateComponentStatus(componentId);
          const refreshed = await db.query.statusPageComponents.findFirst({
            where: eq(statusPageComponents.id, componentId),
          });
          if (refreshed) component = refreshed;
        }
      }
    }

    await logAuditEvent({
      userId,
      action: "component_updated",
      resource: "status_page_component",
      resourceId: component.id,
      metadata: {
        organizationId,
        componentName: component.name,
        statusPageId,
        projectId,
        projectName: ctx.projectName,
      },
      success: true,
    });

    const monitorIds = validatedData.monitorIds ?? (await monitorIdsForComponent(componentId));
    return { ok: true, data: { component, monitorIds } };
  } catch (error) {
    console.error("Error updating component:", error);
    return fail("internal", "Failed to update component. Please try again.");
  }
}

export async function deleteComponent(
  ctx: StatusPageServiceContext,
  statusPageId: string,
  componentId: string
): Promise<ServiceResult<null>> {
  const { userId, organizationId, projectId } = ctx;
  try {
    const uuid = z.string().uuid();
    if (!uuid.safeParse(componentId).success || !uuid.safeParse(statusPageId).success) {
      return fail("validation", "Invalid ID format");
    }

    // SECURITY: Verify status page belongs to this organization and project
    const statusPage = await findOwnedStatusPage(ctx, statusPageId);
    if (!statusPage) {
      console.warn(
        `[SECURITY] User ${userId} attempted to delete component from status page ${statusPageId} without ownership`
      );
      return fail("not_found", "Status page not found or access denied");
    }

    const component = await db.query.statusPageComponents.findFirst({
      where: and(
        eq(statusPageComponents.id, componentId),
        eq(statusPageComponents.statusPageId, statusPageId)
      ),
    });
    if (!component) return fail("not_found", "Component not found or access denied");

    await db
      .delete(statusPageComponents)
      .where(
        and(
          eq(statusPageComponents.id, componentId),
          eq(statusPageComponents.statusPageId, statusPageId)
        )
      );

    await logAuditEvent({
      userId,
      action: "component_deleted",
      resource: "status_page_component",
      resourceId: componentId,
      metadata: {
        organizationId,
        componentName: component.name,
        statusPageId,
        projectId,
        projectName: ctx.projectName,
      },
      success: true,
    });

    return { ok: true, data: null };
  } catch (error) {
    console.error("Error deleting component:", error);
    return fail("internal", "Failed to delete component. Please try again.");
  }
}
