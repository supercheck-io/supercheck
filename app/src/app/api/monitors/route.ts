import { liveMonitor } from "@/lib/deletion/visibility";
import { monitorConfigForRead, monitorTargetForRead } from "@/lib/monitor-read-config";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitors,
  monitorTags,
  notificationProviders,
  projects,
  tags,
} from "@/db/schema";
import { eq, desc, and, sql, inArray, ne } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { isUuid } from "@/lib/uuid";
import {
  insertMonitorRecord,
  scheduleCreatedMonitor,
  updateMonitorHandler,
} from "@/lib/monitor-service";
import { logAuditEvent } from "@/lib/audit-logger";
import { checkMonitorLimit, countPlanMonitors, resumeRefusalResponse, ResumeRefusedError } from "@/lib/middleware/plan-enforcement";
import { monitorResumeBlockedResponse, trialIntervalErrorResponse } from "@/lib/execution/trial-interval-response";
import { insertWithinPlanLimit, notInDeletedProject } from "@/lib/middleware/plan-limit-lock";
import {
  subscriptionService,
  SubscriptionAccessDeniedError,
} from "@/lib/services/subscription-service";
import { getProjectAvailableLocationCodes } from "@/lib/location-registry";
import {
  findUnsupportedMonitorLocations,
  unsupportedMonitorLocationsMessage,
} from "@/lib/monitor-location-routing";
import type { LocationConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { channelsOptional } from "@/lib/incident-settings";
import { validateMonitorConfiguration } from "@/lib/monitor-validation";
import { validateMonitorSecretRefs } from "@/lib/monitor-secret-refs";
import { validateMonitorTargetAddress } from "@/lib/monitor-target-policy";
import {
  AlertConfigConflictError,
  alertProvidersSent,
  frequencyMinutesError,
  InvalidNotificationProvidersError,
  MonitorScheduleError,
  monitorNameError,
  normalizeMonitorAlertConfig,
  preserveWorkerConfigKeys,
  providerIdsOutsideProject,
  SCHEDULE_FAILURE_MESSAGE,
  sanitizeMonitorFields,
  syncMonitorProviderRows,
  scheduleFailureResponse,
  syntheticFrequencyError,
  thrownStatusResponse,
  timeoutFrequencyError,
} from "@/lib/monitor-write";
import type { AlertConfig } from "@/db/schema";
import { loadCreators } from "@/lib/creators";

import { permissionDeniedResponse } from "@/lib/deletion/org-state";
const logger = createLogger({ module: "monitors-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

const trialFrequencyError = trialIntervalErrorResponse;

type MonitorTagSummary = { id: string; name: string; color: string | null };

/** Tags of the listed monitors, so the CLI can round-trip monitor tags as code. */
async function loadMonitorTags(monitorIds: string[]): Promise<Map<string, MonitorTagSummary[]>> {
  const byMonitor = new Map<string, MonitorTagSummary[]>();
  if (monitorIds.length === 0) return byMonitor;
  const rows = await db
    .select({ monitorId: monitorTags.monitorId, id: tags.id, name: tags.name, color: tags.color })
    .from(monitorTags)
    .innerJoin(tags, eq(monitorTags.tagId, tags.id))
    .where(inArray(monitorTags.monitorId, monitorIds))
    .orderBy(tags.name);
  for (const { monitorId, ...tag } of rows) {
    byMonitor.set(monitorId, [...(byMonitor.get(monitorId) ?? []), tag]);
  }
  return byMonitor;
}

export async function GET(request: Request) {
  try {
    // Require authentication and project context
    const context = await requireAuthContext();

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext("monitor", "view", context);
    const canUpdateMonitors = checkPermissionWithContext("monitor", "update", context);

    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Get URL parameters for pagination only (org/project comes from session)
    const url = new URL(request.url);
    // Strict integers only: "abc" or "1.5" would otherwise become NaN and fail the query with a 500.
    const intParam = (name: string, fallback: number) => {
      const raw = url.searchParams.get(name);
      return raw === null || raw === "" ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
    };
    const page = intParam("page", 1);
    const requestedLimit = intParam("limit", 50);
    const limit = Math.min(requestedLimit, 100);

    // For backward compatibility, if no pagination params are provided, return all
    const usePagination =
      url.searchParams.has("page") || url.searchParams.has("limit");

    // SECURITY: Always filter by org/project from session, never trust client params
    const whereCondition = and(
      eq(monitors.projectId, context.project.id),
      eq(monitors.organizationId, context.organizationId),
      liveMonitor(),
    );

    if (usePagination) {
      // Validate pagination parameters
      if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || page < 1 || limit < 1) {
        return NextResponse.json(
          {
            error: "Invalid pagination parameters. Page and limit must be >= 1",
          },
          { status: 400 },
        );
      }

      const offset = (page - 1) * limit;

      // Run count and data queries in parallel for better performance
      const [countResult, monitorsList] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(monitors)
          .where(whereCondition),
        db
          .select()
          .from(monitors)
          .where(whereCondition)
          .orderBy(desc(monitors.id))
          .limit(limit)
          .offset(offset),
      ]);

      const total = Number(countResult[0]?.count || 0);

      const totalPages = Math.ceil(total / limit);
      const tagsByMonitor = await loadMonitorTags(monitorsList.map((m) => m.id));
      const creatorOf = await loadCreators(monitorsList.map((m) => m.createdByUserId));

      return NextResponse.json({
        data: monitorsList.map((monitor) => ({
          ...monitor,
          config: monitorConfigForRead(monitor.config, canUpdateMonitors),
          target: monitorTargetForRead(monitor.target, canUpdateMonitors),
          tags: tagsByMonitor.get(monitor.id) ?? [],
          ...creatorOf(monitor.createdByUserId),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } else {
      // Return monitors with default limit for safety
      // OPTIMIZED: Added default limit to prevent fetching unlimited records
      const DEFAULT_LIMIT = 200;
      const monitorsList = await db
        .select()
        .from(monitors)
        .where(whereCondition)
        .orderBy(desc(monitors.id))
        .limit(DEFAULT_LIMIT);
      const tagsByMonitor = await loadMonitorTags(monitorsList.map((m) => m.id));
      const creatorOf = await loadCreators(monitorsList.map((m) => m.createdByUserId));

      // Return standardized response format for React Query hooks
      return NextResponse.json({
        data: monitorsList.map((monitor) => ({
          ...monitor,
          config: monitorConfigForRead(monitor.config, canUpdateMonitors),
          target: monitorTargetForRead(monitor.target, canUpdateMonitors),
          tags: tagsByMonitor.get(monitor.id) ?? [],
          ...creatorOf(monitor.createdByUserId),
        })),
        pagination: {
          total: monitorsList.length,
          page: 1,
          limit: DEFAULT_LIMIT,
          totalPages: 1,
          hasMore: monitorsList.length === DEFAULT_LIMIT, // Indicate if there might be more
        },
      });
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: authErrorStatus(error) },
      );
    }
    logger.error({ err: error }, "Error fetching monitors");
    return NextResponse.json(
      { error: "Failed to fetch monitors" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCtx = await requireAuthContext();
    const { userId, project, organizationId } = authCtx;

    // Authorize before rate limiting or billing checks, so a viewer gets 403 rather than 429/402.
    if (!checkPermissionWithContext("monitor", "create", authCtx)) {
      return await permissionDeniedResponse(organizationId, "Insufficient permissions to create monitors");
    }

    // SECURITY: Rate limiting to prevent API abuse
    const { checkMonitorApiRateLimit } = await import("@/lib/session-security");
    const rateLimitResult = await checkMonitorApiRateLimit(
      userId,
      organizationId,
      "create",
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter || 60),
          },
        },
      );
    }

    // SECURITY: Validate subscription before allowing monitor creation
    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);

    let rawData;
    try {
      rawData = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    logger.debug(
      { type: rawData.type, name: rawData.name },
      "[MONITOR_CREATE] Raw data received",
    );

    // Same name and target handling as the update paths; credentials in config are never rewritten.
    sanitizeMonitorFields(rawData);


    // Special logging for heartbeat monitors
    if (rawData.type === "heartbeat") {
      logger.debug("[MONITOR_CREATE] Processing heartbeat monitor");
    }

    // Validate required fields
    if (!rawData.name || !rawData.type) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          details: "name and type are required",
        },
        { status: 400 },
      );
    }

    // Matches the monitors.name varchar(255) column; longer values would fail the insert with a 500.
    if (typeof rawData.name !== "string" || [...rawData.name].length > 255) {
      return NextResponse.json(
        { error: "Invalid name", details: "name must be 1-255 characters" },
        { status: 400 },
      );
    }

    if (rawData.frequencyMinutes !== undefined) {
      const frequencyError = frequencyMinutesError(rawData.frequencyMinutes);
      if (frequencyError) {
        return NextResponse.json({ error: "Invalid frequency", details: frequencyError }, { status: 400 });
      }
    }
    const timeoutCreateError = timeoutFrequencyError(null, { config: rawData.config, frequencyMinutes: rawData.frequencyMinutes ?? 5 });
    if (timeoutCreateError) {
      return NextResponse.json({ error: "Invalid configuration", details: timeoutCreateError }, { status: 400 });
    }

    const syntheticCreateError = syntheticFrequencyError(rawData.type, rawData.frequencyMinutes ?? 5);
    if (syntheticCreateError) {
      return NextResponse.json({ error: "Invalid frequency", details: syntheticCreateError }, { status: 400 });
    }

    const trialIntervalError = await trialFrequencyError(organizationId, rawData.frequencyMinutes ?? 5);
    if (trialIntervalError) return trialIntervalError;

    // Validate target - all monitor types require a target except heartbeat and synthetic_test
    if (rawData.type === "synthetic_test") {
      // For synthetic monitors, validate testId in config
      if (!rawData.config?.testId) {
        return NextResponse.json(
          {
            error: "testId is required in config for synthetic monitors",
            details: "Please select a test to monitor",
          },
          { status: 400 },
        );
      }
      // The test lookup below runs before the full configuration validation, and a malformed id would fail
      // it with a Postgres uuid error (a 500) instead of this 400.
      // Check the value itself, not String(value): a one-element array stringifies to a valid-looking id but
      // would still reach the uuid column as an array.
      if (typeof rawData.config.testId !== "string" || !isUuid(rawData.config.testId)) {
        return NextResponse.json(
          {
            error: "Invalid monitor configuration",
            details: "config.testId must be a valid test ID for synthetic monitors",
          },
          { status: 400 },
        );
      }

      // Verify test exists and user has access
      const { tests } = await import("@/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const test = await db.query.tests.findFirst({
        where: and(
          eq(tests.id, rawData.config.testId),
          eq(tests.projectId, project.id),
          eq(tests.organizationId, organizationId),
        ),
        columns: {
          id: true,
          title: true,
          type: true,
        },
      });

      if (!test) {
        return NextResponse.json(
          {
            error: "Test not found or access denied",
            details:
              "The selected test does not exist or you do not have permission to access it",
          },
          { status: 404 },
        );
      }

      // Auto-set target to testId for consistency
      rawData.target = rawData.config.testId;

      // Cache test title in config for display purposes
      if (!rawData.config.testTitle) {
        rawData.config.testTitle = test.title;
      }

      logger.debug(
        { testTitle: test.title },
        "[MONITOR_CREATE] Creating synthetic monitor for test",
      );
    } else if (rawData.type !== "heartbeat" && !rawData.target) {
      return NextResponse.json(
        { error: "Target is required for this monitor type" },
        { status: 400 },
      );
    }

    const configurationValidation = validateMonitorConfiguration({
      type: rawData.type,
      target: rawData.target,
      config: rawData.config,
      incomingConfig: rawData.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }
    const secretRefs = await validateMonitorSecretRefs(project.id, rawData.config);
    if (!secretRefs.success) {
      return NextResponse.json(secretRefs, { status: 400 });
    }
    const targetValidation = await validateMonitorTargetAddress({ type: rawData.type, target: rawData.target });
    if (!targetValidation.success) {
      return NextResponse.json(targetValidation, { status: 400 });
    }

    // Prepare alert configuration - ensure it's properly structured and saved to alertConfig column
    let alertConfig = null;
    if (rawData.alertConfig) {
      const normalized = normalizeMonitorAlertConfig(rawData.alertConfig);
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error }, { status: 400 });
      }
      alertConfig = normalized.value;
      logger.debug(
        { alertEnabled: alertConfig?.enabled },
        "[MONITOR_CREATE] Processed alert config",
      );
    }

    // Construct the config object (for monitor-specific settings, not alerts)
    // A new monitor has no worker state; a client must not forge it (e.g. a stored certificate).
    const finalConfig = preserveWorkerConfigKeys(null, rawData.config || {});

    // Validate locationConfig.locations against enabled locations in DB
    if (finalConfig.locationConfig?.locations?.length > 0) {
      const enabledCodes = await getProjectAvailableLocationCodes(project.id);
      const invalidLocations = (
        finalConfig.locationConfig.locations as string[]
      ).filter((loc: string) => !enabledCodes.includes(loc));
      if (invalidLocations.length > 0) {
        return NextResponse.json(
          { error: `Invalid location codes: ${invalidLocations.join(", ")}` },
          { status: 400 },
        );
      }
    }

    const unsupportedCreate = await findUnsupportedMonitorLocations(
      finalConfig.locationConfig,
      rawData.type,
    );
    if (unsupportedCreate.length > 0) {
      return NextResponse.json(
        { error: unsupportedMonitorLocationsMessage(unsupportedCreate, rawData.type) },
        { status: 400 },
      );
    }

    // Use current project context
    const targetProjectId = project.id;

    // Use the monitor service to create the monitor
    const monitorData = {
      name: rawData.name,
      description: rawData.description,
      type: rawData.type,
      target: rawData.target,
      frequencyMinutes: rawData.frequencyMinutes || 5,
      enabled: rawData.enabled !== false, // Default to true
      config: finalConfig,
      alertConfig: alertConfig,
      createdByUserId: userId,
      projectId: targetProjectId,
      organizationId: organizationId,
    };

    // Validate alert configuration if enabled
    if (alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      // Incidents need no channel: with them on, an enabled alert may have none.
      if (
        (!alertConfig.notificationProviders ||
          alertConfig.notificationProviders.length === 0) &&
        !channelsOptional(alertConfig)
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 },
        );
      }

      // Check notification channel limit
      const maxMonitorChannels = parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10,
      );
      if ((alertConfig.notificationProviders?.length ?? 0) > maxMonitorChannels) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxMonitorChannels} notification channels`,
          },
          { status: 400 },
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 },
        );
      }
    }

    // SECURITY: every provider must belong to this org and project, enabled or not; reject rather than create a
    // monitor whose alertConfig lists channels that have no delivery rows.
    if (alertConfig) {
      const invalidProviderIds = await providerIdsOutsideProject(
        alertConfig.notificationProviders,
        organizationId,
        targetProjectId,
      );
      if (invalidProviderIds.length > 0) {
        return NextResponse.json(
          { error: "One or more notification providers are invalid or not accessible in this project" },
          { status: 400 },
        );
      }
    }

    // Serialize count -> limit check -> insert per organization so concurrent
    // requests cannot both pass the plan limit.
    const inserted = await insertWithinPlanLimit({
      organizationId,
      resource: "monitors",
      check: checkMonitorLimit,
      countRows: (tx) => countPlanMonitors(tx, organizationId),
      insert: async (executor) => {
        // Hold the live project so a concurrent project delete cannot miss this new monitor. Without a
        // plan limit the executor is the pool (no transaction), so open one for the lock to hold.
        const insertInLiveProject = async (tx: typeof executor) => {
          const [liveProject] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, targetProjectId), ne(projects.status, "deleted")))
            .for("share");
          if (!liveProject) return null;
          const record = await insertMonitorRecord(monitorData, tx);
          // Same transaction as the monitor row: a failure here must not leave a monitor holding a plan slot without its channels.
          if (alertConfig && alertConfig.notificationProviders.length > 0) {
            await syncMonitorProviderRows(tx, record.newMonitor.id, alertConfig.notificationProviders, organizationId, targetProjectId);
          }
          return record;
        };
        return executor === db ? db.transaction(insertInLiveProject) : insertInLiveProject(executor);
      },
    });
    if (!inserted.ok && inserted.busy) {
      return NextResponse.json(
        { error: "Too many concurrent requests. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }
    if (!inserted.ok) {
      const limitCheck = inserted.check;
      logger.warn(
        { organizationId },
        `Monitor limit reached: ${limitCheck.error}`,
      );
      return NextResponse.json(
        {
          error: limitCheck.error,
          upgrade: limitCheck.upgrade,
          currentPlan: limitCheck.currentPlan,
          limit: limitCheck.limit,
        },
        { status: 403 },
      );
    }
    if (!inserted.row) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const createdMonitor = inserted.row.newMonitor;
    let newMonitor;
    try {
      newMonitor = await scheduleCreatedMonitor(createdMonitor, inserted.row.enabled);
    } catch (scheduleError) {
      // A monitor that never runs would still count against the plan and invite a duplicate on retry.
      await db.delete(monitors).where(eq(monitors.id, createdMonitor.id));
      throw scheduleError;
    }

    // A project or organization delete that committed between the insert and scheduling would
    // leave this schedule behind; drop it if the monitor is gone or its project is deleted.
    const { deleteScheduledMonitor } = await import("@/lib/monitor-scheduler");
    let stillLive;
    try {
      [stillLive] = await db
        .select({ id: monitors.id })
        .from(monitors)
        .innerJoin(projects, eq(projects.id, monitors.projectId))
        .where(and(eq(monitors.id, createdMonitor.id), ne(projects.status, "deleted")))
        .limit(1);
    } catch (checkError) {
      // The schedule exists now: undo both (best effort) so a retry does not duplicate them.
      await deleteScheduledMonitor(createdMonitor.id).catch((e) => console.error("Failed to remove schedule:", e));
      await db.delete(monitors).where(eq(monitors.id, createdMonitor.id)).catch((e) => console.error("Failed to remove monitor:", e));
      throw checkError;
    }
    if (!stillLive) {
      await deleteScheduledMonitor(createdMonitor.id).catch(() => false);
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Log the audit event for monitor creation
    await logAuditEvent({
      userId,
      organizationId,
      action: "monitor_created",
      resource: "monitor",
      resourceId: newMonitor.id,
      metadata: {
        monitorName: monitorData.name,
        monitorType: monitorData.type,
        target: monitorData.target,
        frequencyMinutes: monitorData.frequencyMinutes,
        projectId: project.id,
        projectName: project.name,
        alertsEnabled: alertConfig?.enabled || false,
        notificationProvidersCount:
          alertConfig?.notificationProviders?.length || 0,
        ...(finalConfig.aiEndpoint ? { preset: "ai_endpoint" } : {}),
      },
      success: true,
    });

    logger.info(
      { monitorId: newMonitor.id },
      "[MONITOR_CREATE] Successfully created monitor",
    );
    return NextResponse.json(newMonitor, { status: 201 });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: authErrorStatus(error) },
      );
    }
    if (error instanceof SubscriptionAccessDeniedError) {
      return NextResponse.json(
        { error: error.message, code: error.reason },
        { status: 402 },
      );
    }
    if (error instanceof InvalidNotificationProvidersError || error instanceof AlertConfigConflictError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const thrown = thrownStatusResponse(error);
    if (thrown) return thrown;
    logger.error({ err: error }, "Error creating monitor");
    return NextResponse.json(
      { error: "Failed to create monitor" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const putCtx = await requireAuthContext();
    const { userId, project, organizationId } = putCtx;

    // Permission before existence, and the same action as PUT /api/monitors/[id], so a 404 never leaks to a caller who may not update.
    if (!checkPermissionWithContext("monitor", "update", putCtx)) {
      return await permissionDeniedResponse(organizationId, "Insufficient permissions to update monitors");
    }

    let rawData;
    try {
      rawData = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { id, ...updateData } = rawData;

    if (!id) {
      return NextResponse.json(
        { error: "Monitor ID is required" },
        { status: 400 },
      );
    }
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Verify monitor belongs to current project context
    const monitorData = await db
      .select({
        projectId: monitors.projectId,
        organizationId: monitors.organizationId,
        type: monitors.type,
        frequencyMinutes: monitors.frequencyMinutes,
        status: monitors.status,
        alertConfig: monitors.alertConfig,
        target: monitors.target,
        config: monitors.config,
      })
      .from(monitors)
      .where(
        and(
          eq(monitors.id, id),
          eq(monitors.projectId, project.id),
          eq(monitors.organizationId, organizationId),
          liveMonitor(),
        ),
      )
      .limit(1);

    if (monitorData.length === 0) {
      return NextResponse.json(
        { error: "Monitor not found or access denied" },
        { status: 404 },
      );
    }

    // Same name and target handling as create; credentials in config are never rewritten.
    sanitizeMonitorFields(updateData);
    const nameError = monitorNameError(updateData.name);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

    if (rawData.frequencyMinutes !== undefined) {
      const frequencyError = frequencyMinutesError(rawData.frequencyMinutes);
      if (frequencyError) {
        return NextResponse.json({ error: "Invalid frequency", details: frequencyError }, { status: 400 });
      }
    }
    {
      const timeoutError = timeoutFrequencyError(monitorData[0], {
        config: updateData.config ?? monitorData[0].config,
        frequencyMinutes: rawData.frequencyMinutes ?? monitorData[0].frequencyMinutes,
      });
      if (timeoutError) return NextResponse.json({ error: "Invalid configuration", details: timeoutError }, { status: 400 });
    }

    // Only a change to type or frequency is checked, so legacy sub-5-minute monitors can still be paused or renamed.
    const syntheticUpdateError = (rawData.type !== undefined || rawData.frequencyMinutes !== undefined) && syntheticFrequencyError(
      rawData.type ?? monitorData[0].type,
      rawData.frequencyMinutes ?? monitorData[0].frequencyMinutes,
    );
    if (syntheticUpdateError) {
      return NextResponse.json({ error: "Invalid frequency", details: syntheticUpdateError }, { status: 400 });
    }

    if (rawData.frequencyMinutes !== undefined) {
      const trialIntervalError = await trialFrequencyError(monitorData[0].organizationId, rawData.frequencyMinutes);
      if (trialIntervalError) return trialIntervalError;
    }

    const resumeBlocked = await monitorResumeBlockedResponse(
      monitorData[0].organizationId,
      monitorData[0].status,
      rawData,
    );
    if (resumeBlocked) return resumeBlocked;

    const configurationValidation = validateMonitorConfiguration({
      type: updateData.type ?? monitorData[0].type,
      target: updateData.target ?? monitorData[0].target,
      config: updateData.config ?? monitorData[0].config,
      incomingConfig: updateData.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }
    const secretRefs = await validateMonitorSecretRefs(project.id, updateData.config);
    if (!secretRefs.success) {
      return NextResponse.json(secretRefs, { status: 400 });
    }
    // Only a changed target or type is checked, so a monitor already pointing at an internal host stays editable.
    const effectiveU3 = { type: updateData.type ?? monitorData[0].type, target: updateData.target ?? monitorData[0].target };
    if (effectiveU3.type !== monitorData[0].type || effectiveU3.target !== monitorData[0].target) {
      const targetValidation = await validateMonitorTargetAddress(effectiveU3);
      if (!targetValidation.success) {
        return NextResponse.json(targetValidation, { status: 400 });
      }
    }

    // Validate synthetic test monitor updates
    const bulkType = updateData.type ?? monitorData[0].type;
    const syntheticTestId = (rawData.config ?? monitorData[0].config)?.testId;
    if (
      bulkType === "synthetic_test" &&
      syntheticTestId &&
      (rawData.config?.testId !== undefined || bulkType !== monitorData[0].type)
    ) {
      const { tests } = await import("@/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const test = await db.query.tests.findFirst({
        where: and(
          eq(tests.id, syntheticTestId),
          eq(tests.projectId, project.id),
          eq(tests.organizationId, organizationId),
        ),
        columns: {
          id: true,
          title: true,
          type: true,
        },
      });

      if (!test) {
        return NextResponse.json(
          {
            error: "Test not found or access denied",
            details:
              "The selected test does not exist or you do not have permission to access it",
          },
          { status: 404 },
        );
      }

      // Update cached test title
      if (rawData.config && !rawData.config.testTitle) {
        rawData.config.testTitle = test.title;
      }

      logger.debug(
        { testTitle: test.title },
        "[MONITOR_UPDATE] Updating synthetic monitor for test",
      );
    }

    // Only apply alertConfig when the body has it; an explicit null clears it (and the delivery rows).
    let alertConfig: AlertConfig | null | undefined;
    if (Object.prototype.hasOwnProperty.call(rawData, "alertConfig")) {
      if (rawData.alertConfig === null) {
        alertConfig = null;
      } else if (typeof rawData.alertConfig !== "object" || Array.isArray(rawData.alertConfig)) {
        return NextResponse.json({ error: "alertConfig must be an object or null" }, { status: 400 });
      } else {
        const normalized = normalizeMonitorAlertConfig(rawData.alertConfig, monitorData[0].alertConfig);
        if (!normalized.ok) {
          return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        alertConfig = normalized.value;
      }
    }

    // Use the monitor service to update the monitor
    // Validate locationConfig.locations against enabled locations in DB
    if (updateData.config?.locationConfig?.locations?.length > 0) {
      const enabledCodes = await getProjectAvailableLocationCodes(project.id);
      const invalidLocations = (
        updateData.config.locationConfig.locations as string[]
      ).filter((loc: string) => !enabledCodes.includes(loc));
      if (invalidLocations.length > 0) {
        return NextResponse.json(
          { error: `Invalid location codes: ${invalidLocations.join(", ")}` },
          { status: 400 },
        );
      }
    }

    if (updateData.config || updateData.type) {
      const effectiveType = updateData.type ?? monitorData[0]?.type;
      const effectiveConfig = (updateData.config ?? monitorData[0]?.config) as
        | { locationConfig?: LocationConfig | null }
        | null
        | undefined;
      const unsupportedUpdate = await findUnsupportedMonitorLocations(
        effectiveConfig?.locationConfig,
        effectiveType,
      );
      if (unsupportedUpdate.length > 0) {
        return NextResponse.json(
          { error: unsupportedMonitorLocationsMessage(unsupportedUpdate, effectiveType) },
          { status: 400 },
        );
      }
    }

    const monitorUpdateData = {
      name: updateData.name,
      description: updateData.description,
      type: updateData.type,
      target: updateData.target,
      frequencyMinutes: updateData.frequencyMinutes,
      enabled: updateData.enabled,
      config: updateData.config,
      alertConfig: alertConfig,
    };

    // Validate alert configuration if enabled
    if (alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      // Incidents need no channel: with them on, an enabled alert may have none.
      if (
        (!alertConfig.notificationProviders ||
          alertConfig.notificationProviders.length === 0) &&
        !channelsOptional(alertConfig)
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 },
        );
      }

      // Check notification channel limit
      const maxMonitorChannels = parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10,
      );
      if ((alertConfig.notificationProviders?.length ?? 0) > maxMonitorChannels) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxMonitorChannels} notification channels`,
          },
          { status: 400 },
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 },
        );
      }
    }

    // Provider ids are validated and rows synced only when the body carries the list (or null).
    const syncProviders = alertConfig !== undefined && alertProvidersSent(rawData.alertConfig);
    if (alertConfig && syncProviders) {
      // Ids the monitor already stored may have been deleted since; only newly supplied ids must exist.
      const storedIds = (monitorData[0].alertConfig?.notificationProviders ?? []).map((id) => id.toLowerCase());
      const invalidProviderIds = await providerIdsOutsideProject(
        alertConfig.notificationProviders.filter((id) => !storedIds.includes(id)),
        organizationId,
        project.id,
      );
      if (invalidProviderIds.length > 0) {
        return NextResponse.json(
          { error: "One or more notification providers are invalid or not accessible in this project" },
          { status: 400 },
        );
      }
    }

    let updatedMonitor;
    let scheduleFailed = false;
    try {
      updatedMonitor = await updateMonitorHandler(
        id,
        monitorUpdateData,
        syncProviders
          ? { providerSync: { ids: alertConfig?.notificationProviders ?? [], organizationId, projectId: project.id, storedIds: monitorData[0].alertConfig?.notificationProviders } }
          : {},
      );
    } catch (error) {
      if (error instanceof ResumeRefusedError) return resumeRefusalResponse(error.outcome)!;
      if (error instanceof InvalidNotificationProvidersError || error instanceof AlertConfigConflictError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof MonitorScheduleError && error.monitor) {
        // Saved but not rescheduled: audit the change, then answer 503.
        updatedMonitor = error.monitor;
        scheduleFailed = true;
      } else {
        const scheduleFailure = scheduleFailureResponse(error);
        if (scheduleFailure) return scheduleFailure;
        const thrown = thrownStatusResponse(error);
        if (thrown) return thrown;
        throw error;
      }
    }

    // Log the audit event for monitor update
    await logAuditEvent({
      userId,
      organizationId,
      action: "monitor_updated",
      resource: "monitor",
      resourceId: id,
      metadata: {
        ...(monitorUpdateData.config?.aiEndpoint ? { preset: "ai_endpoint" } : {}),
        monitorName: monitorUpdateData.name,
        monitorType: monitorUpdateData.type,
        target: monitorUpdateData.target,
        frequencyMinutes: monitorUpdateData.frequencyMinutes,
        enabled: monitorUpdateData.enabled,
        projectId: project.id,
        projectName: project.name,
        alertsEnabled: alertConfig?.enabled || false,
        notificationProvidersCount:
          alertConfig?.notificationProviders?.length || 0,
      },
      success: true,
    });

    if (scheduleFailed) return NextResponse.json({ error: SCHEDULE_FAILURE_MESSAGE }, { status: 503 });
    return NextResponse.json(updatedMonitor);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: authErrorStatus(error) },
      );
    }
    logger.error({ err: error }, "Error updating monitor");
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 },
    );
  }
}
