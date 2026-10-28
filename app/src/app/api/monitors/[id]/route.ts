import { deleteMonitorWithContext } from "@/lib/resource-deletion/monitor";
import { isInvalidUuidError, isUuid } from "@/lib/uuid";
import { isDeepStrictEqual } from "node:util";
import { executionConfig, updateMonitorHandler } from "@/lib/monitor-service";
import { monitorResumeBlockedResponse, trialIntervalErrorResponse } from "@/lib/execution/trial-interval-response";
import { monitorConfigForRead, monitorTargetForRead, monitorResultDetailsForRead } from "@/lib/monitor-read-config";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitors,
  monitorResults,
  monitorsUpdateSchema,
  monitorNotificationSettings,
  notificationProviders,
} from "@/db/schema";
import { MonitorType, MonitorStatus } from "@/db/schema/types";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  scheduleMonitor,
  deleteScheduledMonitor,
} from "@/lib/monitor-scheduler";
import { MonitorJobData } from "@/lib/queue";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  createS3CleanupService,
  type ReportDeletionInput,
} from "@/lib/s3-cleanup";
import { createLogger } from "@/lib/logger/index";
import { validateMonitorConfiguration } from "@/lib/monitor-validation";
import {
  enabledAlertConfigError,
  normalizeMonitorAlertConfig,
  preserveWorkerConfigKeys,
  replaceMonitorProviders,
  testInProject,
} from "@/lib/monitor-write";
import {
  findLocationsOutsideProject,
  findUnsupportedMonitorLocations,
  unsupportedMonitorLocationsMessage,
} from "@/lib/monitor-location-routing";
import type { LocationConfig } from "@/db/schema";

const logger = createLogger({ module: "monitor-detail-api" }) as {
  debug: (data: unknown, msg?: string) => void;
  info: (data: unknown, msg?: string) => void;
  warn: (data: unknown, msg?: string) => void;
  error: (data: unknown, msg?: string) => void;
};

// Hardcoded limit for charts and metrics display
// This is NOT for the table - table uses paginated /results endpoint
const RECENT_RESULTS_LIMIT = 100;

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 },
    );
  }

  try {
    const context = await requireAuthContext();

    // Check permission via context (works for both session and CLI auth)
    const canView = checkPermissionWithContext("monitor", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view this monitor" },
        { status: 403 },
      );
    }

    // Find the monitor scoped to current organization and project (defense-in-depth)
    if (!isUuid((await routeContext.params).id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    const monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, context.project.id),
        eq(monitors.organizationId, context.organizationId),
      ),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    const recentResults = await db
      .select()
      .from(monitorResults)
      .where(eq(monitorResults.monitorId, id))
      .orderBy(desc(monitorResults.checkedAt))
      .limit(RECENT_RESULTS_LIMIT);

    const canUpdateMonitor = checkPermissionWithContext("monitor", "update", context);
    // Ensure alertConfig has proper defaults if it's null or undefined
    const responseMonitor = {
      ...monitor,
      config: monitorConfigForRead(monitor.config, canUpdateMonitor),
      target: monitorTargetForRead(monitor.target, canUpdateMonitor),
      recentResults: recentResults.map((result) => ({ ...result, details: monitorResultDetailsForRead(result.details) })),
      alertConfig: monitor.alertConfig || {
        enabled: false,
        notificationProviders: [],
        alertOnFailure: true,
        alertOnRecovery: true,
        alertOnSslExpiration: false,
        failureThreshold: 1,
        recoveryThreshold: 1,
        customMessage: "",
      },
    };

    return NextResponse.json(responseMonitor);
  } catch (error) {
    if (isInvalidUuidError(error)) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: 401 },
      );
    }
    logger.error({ err: error, monitorId: id }, "Error fetching monitor");
    return NextResponse.json(
      { error: "Failed to fetch monitor data" },
      { status: 500 },
    );
  }
}

// Allowlist: createUpdateSchema accepts every column, including organizationId, projectId and scheduledJobId.
const monitorWritableSchema = monitorsUpdateSchema.pick({
  name: true,
  description: true,
  type: true,
  target: true,
  frequencyMinutes: true,
  enabled: true,
  status: true,
  config: true,
});

export async function PUT(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 },
    );
  }

  try {
    const authCtx = await requireAuthContext();
    const userId = authCtx.userId;

    // Permission first: an unauthorised caller must not get validation detail or learn whether the monitor exists.
    const canUpdate = checkPermissionWithContext("monitor", "update", authCtx);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const rawData = await request.json();
    const validationResult = monitorWritableSchema.safeParse(rawData);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.format() },
        { status: 400 },
      );
    }

    const updateData = validationResult.data;

    if (!isUuid(id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });

    // Find the monitor scoped to current organization and project (defense-in-depth)
    const currentMonitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, authCtx.project.id),
        eq(monitors.organizationId, authCtx.organizationId),
      ),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    if (rawData.frequencyMinutes !== undefined) {
      const trialIntervalError = await trialIntervalErrorResponse(currentMonitor.organizationId, rawData.frequencyMinutes);
      if (trialIntervalError) return trialIntervalError;
    }

    const resumeBlocked = await monitorResumeBlockedResponse(currentMonitor.organizationId, currentMonitor.status, rawData);
    if (resumeBlocked) return resumeBlocked;

    const configurationValidation = validateMonitorConfiguration({
      type: updateData.type ?? currentMonitor.type,
      target: updateData.target ?? currentMonitor.target,
      config: updateData.config ?? currentMonitor.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }

    // Re-check ownership whenever the test is supplied or the monitor becomes synthetic (a stored testId is not trusted).
    const putType = updateData.type ?? currentMonitor.type;
    const putTestId = (updateData.config ?? currentMonitor.config)?.testId;
    if (
      putType === "synthetic_test" &&
      putTestId !== undefined &&
      (updateData.config?.testId !== undefined || putType !== currentMonitor.type) &&
      !(await testInProject(putTestId, authCtx.organizationId, authCtx.project.id))
    ) {
      return NextResponse.json(
        { error: "Test not found or access denied" },
        { status: 404 },
      );
    }

    if (updateData.config?.locationConfig) {
      const outside = await findLocationsOutsideProject(
        updateData.config.locationConfig as LocationConfig,
        authCtx.project.id,
      );
      if (outside.length > 0) {
        return NextResponse.json(
          { error: `Invalid location codes: ${outside.join(", ")}` },
          { status: 400 },
        );
      }
    }

    if (updateData.config || updateData.type) {
      const effectiveType = updateData.type ?? currentMonitor.type;
      const effectiveConfig = (updateData.config ?? currentMonitor.config) as
        | { locationConfig?: LocationConfig | null }
        | null
        | undefined;
      const unsupported = await findUnsupportedMonitorLocations(
        effectiveConfig?.locationConfig,
        effectiveType,
      );
      if (unsupported.length > 0) {
        return NextResponse.json(
          { error: unsupportedMonitorLocationsMessage(unsupported, effectiveType) },
          { status: 400 },
        );
      }
    }

    // Validate frequency bounds (1 minute minimum, 1440 minutes = 24 hours maximum)
    const MIN_FREQUENCY_MINUTES = 1;
    const MAX_FREQUENCY_MINUTES = 1440; // 24 hours

    if (rawData.frequencyMinutes !== undefined) {
      const freq = Number(rawData.frequencyMinutes);
      if (
        isNaN(freq) ||
        freq < MIN_FREQUENCY_MINUTES ||
        freq > MAX_FREQUENCY_MINUTES
      ) {
        return NextResponse.json(
          {
            error: "Invalid frequency",
            details: `frequencyMinutes must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
          },
          { status: 400 },
        );
      }
    }

    // Prepare update data. Only the writable columns are taken from the body: tenant ids, the scheduler id and
    // the other server-owned columns must not be settable by a client.
    const { type, status, ...restUpdate } = updateData;
    const updatePayload: Partial<typeof monitors.$inferInsert> = {
      ...restUpdate,
      updatedAt: new Date(),
    };

    if (type) {
      updatePayload.type = type as MonitorType;
    }

    if (status) {
      updatePayload.status = status as MonitorStatus;
    }

    // Keep enabled and status in step, as PATCH does: the scheduler skips a monitor with enabled=false.
    if (status && rawData.enabled === undefined) {
      updatePayload.enabled = status !== "paused";
    } else if (rawData.enabled === false && !status) {
      updatePayload.status = "paused";
    } else if (rawData.enabled === true && !status && currentMonitor.status === "paused") {
      updatePayload.status = "pending";
    }

    if (updateData.config) {
      updatePayload.config = preserveWorkerConfigKeys(currentMonitor.config, updateData.config);
    }

    let normalizedProviderIds: string[] = [];
    // Only update alertConfig if it's explicitly provided; otherwise existing alert settings are preserved
    if (rawData.hasOwnProperty("alertConfig")) {
      if (rawData.alertConfig) {
        const normalized = normalizeMonitorAlertConfig(rawData.alertConfig);
        if (!normalized.ok) {
          return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const alertError = enabledAlertConfigError(normalized.value);
        if (alertError) {
          return NextResponse.json({ error: alertError }, { status: 400 });
        }
        updatePayload.alertConfig = normalized.value;
        normalizedProviderIds = Array.from(new Set(normalized.value.notificationProviders));
      } else {
        updatePayload.alertConfig = null;
      }
    }

    const shouldSyncNotificationProviders = Boolean(
      updatePayload.alertConfig?.enabled && rawData.alertConfig,
    );

    const NOTIFICATION_PROVIDER_VALIDATION_ERROR =
      "NOTIFICATION_PROVIDER_VALIDATION_FAILED";

    let updatedMonitor;
    try {
      updatedMonitor = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(monitors)
          .set(updatePayload)
          .where(
            and(
              eq(monitors.id, id),
              eq(monitors.projectId, authCtx.project.id),
              eq(monitors.organizationId, authCtx.organizationId),
            ),
          )
          .returning();

        if (!updated) {
          return null;
        }

        if (shouldSyncNotificationProviders) {
          // Validate notification providers inside the transaction to prevent TOCTOU race conditions
          if (normalizedProviderIds.length > 0) {
            const validProviders = await tx
              .select({ id: notificationProviders.id })
              .from(notificationProviders)
              .where(
                and(
                  inArray(notificationProviders.id, normalizedProviderIds),
                  eq(
                    notificationProviders.organizationId,
                    authCtx.organizationId,
                  ),
                  eq(notificationProviders.projectId, authCtx.project.id),
                ),
              );

            if (validProviders.length !== normalizedProviderIds.length) {
              throw new Error(NOTIFICATION_PROVIDER_VALIDATION_ERROR);
            }
          }

          await tx
            .delete(monitorNotificationSettings)
            .where(eq(monitorNotificationSettings.monitorId, id));

          if (normalizedProviderIds.length > 0) {
            await tx
              .insert(monitorNotificationSettings)
              .values(
                normalizedProviderIds.map((providerId: string) => ({
                  monitorId: id,
                  notificationProviderId: providerId,
                })),
              )
              .onConflictDoNothing();
          }
        }

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === NOTIFICATION_PROVIDER_VALIDATION_ERROR
      ) {
        return NextResponse.json(
          {
            error:
              "One or more notification providers are invalid or not accessible in this project",
          },
          { status: 400 },
        );
      }
      throw error;
    }

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Failed to update monitor, monitor not found after update." },
        { status: 404 },
      );
    }

    // Handle scheduling changes for frequency updates
    const oldFrequency = currentMonitor.frequencyMinutes;
    const newFrequency = updatedMonitor.frequencyMinutes;
    const oldStatus = currentMonitor.status;
    const newStatus = updatedMonitor.status;

    const jobData: MonitorJobData = {
      monitorId: updatedMonitor.id,
      projectId: authCtx.project.id,
      type: updatedMonitor.type as MonitorJobData["type"],
      target: updatedMonitor.target,
      config: updatedMonitor.config as Record<string, unknown>,
      frequencyMinutes: newFrequency ?? undefined,
    };

    // Handle status changes (pause/resume)
    if (oldStatus !== newStatus) {
      logger.debug(
        { monitorId: id, oldStatus, newStatus },
        "Monitor status changed",
      );

      if (newStatus === "paused") {
        // Pause monitor - remove from scheduler and clear scheduledJobId
        logger.debug(
          { monitorId: id },
          "Pausing monitor - removing from scheduler",
        );

        // Try both the stored scheduledJobId and the monitor ID
        let deleteSuccess = false;
        if (currentMonitor.scheduledJobId) {
          deleteSuccess = await deleteScheduledMonitor(
            currentMonitor.scheduledJobId,
          );
        }

        if (!deleteSuccess) {
          deleteSuccess = await deleteScheduledMonitor(id);
        }

        // Clear the scheduled job ID from database
        await db
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(
            and(
              eq(monitors.id, id),
              eq(monitors.projectId, authCtx.project.id),
              eq(monitors.organizationId, authCtx.organizationId),
            ),
          );
      } else if (
        oldStatus === "paused" &&
        (newStatus === "up" || newStatus === "down" || newStatus === "pending")
      ) {
        // Resume monitor - add to scheduler if it has valid frequency
        if (newFrequency && newFrequency > 0) {
          logger.debug(
            { monitorId: id, frequencyMinutes: newFrequency },
            "Resuming monitor - adding to scheduler",
          );
          const schedulerId = await scheduleMonitor({
            monitorId: id,
            frequencyMinutes: newFrequency,
            jobData,
            retryLimit: 3,
          });

          // Update monitor with new scheduler ID
          await db
            .update(monitors)
            .set({ scheduledJobId: schedulerId })
            .where(
              and(
                eq(monitors.id, id),
                eq(monitors.projectId, authCtx.project.id),
                eq(monitors.organizationId, authCtx.organizationId),
              ),
            );
        }
      }
    }

    // Handle frequency changes for non-paused monitors OR config changes
    // Same comparison PATCH uses: editing alert channels or regions must not restart the cadence.
    const configChanged = !isDeepStrictEqual(
      executionConfig(currentMonitor.config),
      executionConfig(updatedMonitor.config),
    );
    const targetChanged = currentMonitor.target !== updatedMonitor.target;
    const typeChanged = currentMonitor.type !== updatedMonitor.type;

    // Track alert config changes for audit logging
    const alertConfigChanged =
      JSON.stringify(currentMonitor.alertConfig) !==
      JSON.stringify(updatedMonitor.alertConfig);
    const oldAlertConfig = currentMonitor.alertConfig as Record<
      string,
      unknown
    > | null;
    const newAlertConfig = updatedMonitor.alertConfig as Record<
      string,
      unknown
    > | null;

    if (
      (oldFrequency !== newFrequency ||
        configChanged ||
        targetChanged ||
        typeChanged) &&
      newStatus !== "paused"
    ) {
      // Always remove the old schedule first
      logger.debug(
        {
          monitorId: id,
          oldFrequency,
          newFrequency,
          configChanged,
          targetChanged,
          typeChanged,
        },
        "Rescheduling monitor due to changes",
      );
      await deleteScheduledMonitor(id);

      if (newFrequency && newFrequency > 0) {
        logger.debug(
          { monitorId: id },
          "Scheduling monitor with updated configuration",
        );
        const schedulerId = await scheduleMonitor({
          monitorId: id,
          frequencyMinutes: newFrequency,
          jobData,
          retryLimit: 3,
        });

        // Update monitor with new scheduler ID
        await db
          .update(monitors)
          .set({ scheduledJobId: schedulerId })
          .where(
            and(
              eq(monitors.id, id),
              eq(monitors.projectId, authCtx.project.id),
              eq(monitors.organizationId, authCtx.organizationId),
            ),
          );
      } else {
        logger.debug(
          { monitorId: id, frequency: newFrequency },
          "Monitor frequency cleared, not scheduling",
        );
        // Clear scheduler ID if frequency is 0 or null
        await db
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(
            and(
              eq(monitors.id, id),
              eq(monitors.projectId, authCtx.project.id),
              eq(monitors.organizationId, authCtx.organizationId),
            ),
          );
      }
    }

    // Log the audit event for monitor update
    await logAuditEvent({
      userId,
      organizationId: updatedMonitor.organizationId || undefined,
      action: "monitor_updated",
      resource: "monitor",
      resourceId: id,
      metadata: {
        monitorName: updatedMonitor.name,
        monitorType: updatedMonitor.type,
        target: updatedMonitor.target,
        frequencyMinutes: updatedMonitor.frequencyMinutes,
        enabled: updatedMonitor.enabled,
        projectId: updatedMonitor.projectId,
        statusChanged: oldStatus !== newStatus,
        oldStatus,
        newStatus,
        frequencyChanged: oldFrequency !== newFrequency,
        // Alert configuration change tracking for security audit
        alertConfigChanged,
        ...(alertConfigChanged && {
          alertConfigChanges: {
            alertsEnabled: {
              old: oldAlertConfig?.enabled,
              new: newAlertConfig?.enabled,
            },
            alertOnFailure: {
              old: oldAlertConfig?.alertOnFailure,
              new: newAlertConfig?.alertOnFailure,
            },
            alertOnRecovery: {
              old: oldAlertConfig?.alertOnRecovery,
              new: newAlertConfig?.alertOnRecovery,
            },
            alertOnSslExpiration: {
              old: oldAlertConfig?.alertOnSslExpiration,
              new: newAlertConfig?.alertOnSslExpiration,
            },
            failureThreshold: {
              old: oldAlertConfig?.failureThreshold,
              new: newAlertConfig?.failureThreshold,
            },
            recoveryThreshold: {
              old: oldAlertConfig?.recoveryThreshold,
              new: newAlertConfig?.recoveryThreshold,
            },
          },
        }),
      },
      success: true,
    });

    return NextResponse.json(updatedMonitor);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: 401 },
      );
    }
    logger.error({ err: error, monitorId: id }, "Error updating monitor");
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 },
    );
  }
}

// DELETE method removed - use the server action deleteMonitor() from @/actions/delete-monitor
// This ensures consistent deletion logic with S3 cleanup, Redis unscheduling, and audit logging

function isObject(item: unknown): item is Record<string, unknown> {
  return Boolean(item && typeof item === "object" && !Array.isArray(item));
}

function deepMerge<
  T extends Record<string, unknown>,
  U extends Record<string, unknown>,
>(target: T, source: U): T & U {
  const output = { ...target } as T & U;

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          (output as Record<string, unknown>)[key] = deepMerge(
            target[key] as Record<string, unknown>,
            source[key] as Record<string, unknown>,
          );
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

export async function PATCH(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 },
    );
  }

  try {
    const authCtx = await requireAuthContext();
    const userId = authCtx.userId;

    // Permission first: an unauthorised caller must not get validation detail or learn whether the monitor exists.
    const canUpdate = checkPermissionWithContext("monitor", "update", authCtx);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const rawData = await request.json();

    if (!isUuid(id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });

    // Find the monitor scoped to current organization and project (defense-in-depth)
    const currentMonitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, authCtx.project.id),
        eq(monitors.organizationId, authCtx.organizationId),
      ),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    if (rawData.frequencyMinutes !== undefined) {
      const trialIntervalError = await trialIntervalErrorResponse(currentMonitor.organizationId, rawData.frequencyMinutes);
      if (trialIntervalError) return trialIntervalError;
    }

    const resumeBlocked = await monitorResumeBlockedResponse(currentMonitor.organizationId, currentMonitor.status, rawData);
    if (resumeBlocked) return resumeBlocked;

    const updatePayload: Parameters<typeof updateMonitorHandler>[1] = {};
    for (const key of ["name", "description", "type", "target", "frequencyMinutes", "enabled"] as const) {
      if (rawData[key] !== undefined) Object.assign(updatePayload, { [key]: rawData[key] });
    }
    if (rawData.enabled !== undefined && typeof rawData.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    if (rawData.frequencyMinutes !== undefined &&
      (typeof rawData.frequencyMinutes !== "number" || !Number.isFinite(rawData.frequencyMinutes) ||
       rawData.frequencyMinutes < 1 || rawData.frequencyMinutes > 1440)) {
      return NextResponse.json({ error: "frequencyMinutes must be between 1 and 1440" }, { status: 400 });
    }
    if (rawData.status !== undefined) {
      if (!["paused", "up", "down", "pending"].includes(rawData.status)) {
        return NextResponse.json({ error: "Invalid monitor status" }, { status: 400 });
      }
      if (rawData.enabled !== undefined && rawData.enabled !== (rawData.status !== "paused")) {
        return NextResponse.json({ error: "status and enabled disagree" }, { status: 400 });
      }
      updatePayload.enabled = rawData.status !== "paused";
      updatePayload.status = rawData.status;
    }
    if (rawData.config) updatePayload.config = deepMerge(currentMonitor.config ?? {}, rawData.config);

    const configurationValidation = validateMonitorConfiguration({
      type: updatePayload.type ?? currentMonitor.type,
      target: updatePayload.target ?? currentMonitor.target,
      config: updatePayload.config ?? currentMonitor.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }

    const patchType = updatePayload.type ?? currentMonitor.type;
    const patchTestId = (updatePayload.config ?? currentMonitor.config)?.testId;
    if (
      patchType === "synthetic_test" &&
      patchTestId !== undefined &&
      ((isObject(rawData.config) && rawData.config.testId !== undefined) || patchType !== currentMonitor.type) &&
      !(await testInProject(patchTestId, authCtx.organizationId, authCtx.project.id))
    ) {
      return NextResponse.json({ error: "Test not found or access denied" }, { status: 404 });
    }

    if (rawData.config?.locationConfig) {
      const outside = await findLocationsOutsideProject(
        (updatePayload.config as { locationConfig?: LocationConfig } | undefined)
          ?.locationConfig,
        authCtx.project.id,
      );
      if (outside.length > 0) {
        return NextResponse.json(
          { error: `Invalid location codes: ${outside.join(", ")}` },
          { status: 400 },
        );
      }
    }

    if (rawData.config || rawData.type) {
      const effectiveConfig = (updatePayload.config ?? currentMonitor.config) as
        | { locationConfig?: LocationConfig | null }
        | null
        | undefined;
      const unsupported = await findUnsupportedMonitorLocations(
        effectiveConfig?.locationConfig,
        updatePayload.type ?? currentMonitor.type,
      );
      if (unsupported.length > 0) {
        return NextResponse.json(
          { error: unsupportedMonitorLocationsMessage(unsupported, currentMonitor.type) },
          { status: 400 },
        );
      }
    }

    // Handle partial update for 'alertConfig'
    let providerIdsToSync: string[] | null = null;
    if (rawData.alertConfig) {
      // Same normaliser and rules as PUT, applied to the merged result.
      const normalized = normalizeMonitorAlertConfig(
        deepMerge(currentMonitor.alertConfig ?? {}, rawData.alertConfig),
      );
      const alertError = normalized.ok ? enabledAlertConfigError(normalized.value) : normalized.error;
      if (!normalized.ok || alertError) {
        return NextResponse.json({ error: alertError }, { status: 400 });
      }
      updatePayload.alertConfig = normalized.value;
      if (normalized.value.enabled && Array.isArray(rawData.alertConfig.notificationProviders)) {
        providerIdsToSync = normalized.value.notificationProviders;
      }
    }

    // The worker delivers through monitor_notification_settings, not the JSON column.
    if (
      providerIdsToSync &&
      !(await replaceMonitorProviders(id, providerIdsToSync, authCtx.organizationId, authCtx.project.id))
    ) {
      return NextResponse.json(
        { error: "One or more notification providers are invalid or not accessible in this project" },
        { status: 400 },
      );
    }

    const updatedMonitor = await updateMonitorHandler(id, updatePayload);

    // Log the audit event for monitor partial update
    await logAuditEvent({
      userId,
      organizationId: updatedMonitor.organizationId || undefined,
      action: "monitor_updated",
      resource: "monitor",
      resourceId: id,
      metadata: {
        monitorName: updatedMonitor.name,
        updateType: "partial",
        statusChanged:
          rawData.status && rawData.status !== currentMonitor.status,
        oldStatus: currentMonitor.status,
        newStatus: rawData.status || currentMonitor.status,
        configUpdated: !!rawData.config,
        alertConfigUpdated: !!rawData.alertConfig,
        projectId: updatedMonitor.projectId,
      },
      success: true,
    });

    return NextResponse.json(updatedMonitor);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Authentication required",
        },
        { status: 401 },
      );
    }
    logger.error(
      { err: error, monitorId: id },
      "Error partially updating monitor",
    );
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/monitors/[id]
 * Deletes a monitor with full cleanup (scheduler, S3 reports, audit logging).
 * Mirrors the logic from the deleteMonitor server action.
 */
export async function DELETE(
  _request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await routeContext.params;
    const context = await requireAuthContext();
    if (!checkPermissionWithContext("monitor", "delete", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    if (!isUuid(id)) return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    const result = await deleteMonitorWithContext(id, context);
    const status = result.success ? 200 : result.error?.includes("not found") ? 404 : result.error?.includes("active") ? 409 : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    console.error("Error deleting monitor:", error);
    return NextResponse.json({ success: false, error: "Failed to delete monitor" }, { status: 500 });
  }
}
