import { deleteMonitorWithContext } from "@/lib/resource-deletion/monitor";
import { isInvalidUuidError, isUuid } from "@/lib/uuid";
import { isDeepStrictEqual } from "node:util";
import { executionConfig, updateMonitorHandler } from "@/lib/monitor-service";
import { reconcileMonitorSchedule } from "@/lib/monitor-schedule-reconcile";
import { resumeRefusalResponse, withResumeWithinPlan, ResumeRefusedError } from "@/lib/middleware/plan-enforcement";
import { monitorResumeBlockedResponse, trialIntervalErrorResponse } from "@/lib/execution/trial-interval-response";
import { monitorConfigForRead, monitorTargetForRead, monitorResultForRead } from "@/lib/monitor-read-config";
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
import { requireAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  createS3CleanupService,
  type ReportDeletionInput,
} from "@/lib/s3-cleanup";
import { createLogger } from "@/lib/logger/index";
import { validateMonitorConfiguration } from "@/lib/monitor-validation";
import { validateMonitorTargetAddress } from "@/lib/monitor-target-policy";
import {
  alertProvidersSent,
  enabledAlertConfigError,
  frequencyMinutesError,
  InvalidNotificationProvidersError,
  MonitorScheduleError,
  mergePatch,
  monitorNameError,
  normalizeMonitorAlertConfig,
  preserveWorkerConfigKeys,
  SCHEDULE_FAILURE_MESSAGE,
  sanitizeMonitorFields,
  scheduleFailureResponse,
  syncMonitorProviderRows,
  syntheticFrequencyError,
  thrownStatusResponse,
  timeoutFrequencyError,
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
      recentResults: recentResults.map(monitorResultForRead),
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
        { status: authErrorStatus(error) },
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

    let rawData;
    try {
      rawData = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
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

    // Same name and target handling as create; credentials in config are never rewritten.
    const sanitizeType = updateData.type ?? currentMonitor.type;
    sanitizeMonitorFields(updateData, sanitizeType);
    sanitizeMonitorFields({ alertConfig: rawData.alertConfig }, sanitizeType);
    const nameError = monitorNameError(updateData.name);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

    if (rawData.frequencyMinutes !== undefined) {
      const frequencyError = frequencyMinutesError(rawData.frequencyMinutes);
      if (frequencyError) {
        return NextResponse.json({ error: "Invalid frequency", details: frequencyError }, { status: 400 });
      }
    }
    if (rawData.config !== undefined || rawData.frequencyMinutes !== undefined) {
      const timeoutError = timeoutFrequencyError(
        updateData.config ?? currentMonitor.config,
        updateData.frequencyMinutes ?? currentMonitor.frequencyMinutes,
      );
      if (timeoutError) return NextResponse.json({ error: "Invalid configuration", details: timeoutError }, { status: 400 });
    }

    // Only a change to type or frequency is checked, so legacy sub-5-minute monitors can still be paused or renamed.
    const syntheticError = (rawData.type !== undefined || rawData.frequencyMinutes !== undefined) && syntheticFrequencyError(
      rawData.type ?? currentMonitor.type,
      rawData.frequencyMinutes ?? currentMonitor.frequencyMinutes,
    );
    if (syntheticError) {
      return NextResponse.json({ error: "Invalid frequency", details: syntheticError }, { status: 400 });
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
      incomingConfig: updateData.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }
    // Only a changed target or type is checked, so a monitor already pointing at an internal host stays editable.
    const effectiveU1 = { type: updateData.type ?? currentMonitor.type, target: updateData.target ?? currentMonitor.target };
    if (effectiveU1.type !== currentMonitor.type || effectiveU1.target !== currentMonitor.target) {
      const targetValidation = await validateMonitorTargetAddress(effectiveU1);
      if (!targetValidation.success) {
        return NextResponse.json(targetValidation, { status: 400 });
      }
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

    if (updateData.config === null) {
      return NextResponse.json({ error: "config cannot be null" }, { status: 400 });
    }
    if (updateData.status && rawData.enabled !== undefined && rawData.enabled !== (updateData.status !== "paused")) {
      return NextResponse.json({ error: "status and enabled disagree" }, { status: 400 });
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
      if (rawData.alertConfig === null) {
        updatePayload.alertConfig = null;
      } else if (!isObject(rawData.alertConfig)) {
        return NextResponse.json({ error: "alertConfig must be an object or null" }, { status: 400 });
      } else {
        const normalized = normalizeMonitorAlertConfig(rawData.alertConfig, currentMonitor.alertConfig);
        if (!normalized.ok) {
          return NextResponse.json({ error: normalized.error }, { status: 400 });
        }
        const alertError = enabledAlertConfigError(normalized.value);
        if (alertError) {
          return NextResponse.json({ error: alertError }, { status: 400 });
        }
        updatePayload.alertConfig = normalized.value;
        normalizedProviderIds = Array.from(new Set(normalized.value.notificationProviders));
      }
    }

    // The JSON column is what the UI shows and the rows are what the worker delivers to: an alertConfig write that
    // carries notificationProviders (or null), enabled or not, validates the ids and replaces the rows in the same transaction.
    const shouldSyncNotificationProviders = rawData.hasOwnProperty("alertConfig") && alertProvidersSent(rawData.alertConfig);

    let updatedMonitor;
    try {
      const writeMonitor = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
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
          await syncMonitorProviderRows(tx, id, normalizedProviderIds, authCtx.organizationId, authCtx.project.id);
        }

        return updated;
      };
      // Turning a paused monitor back on takes a plan slot: count and write under the plan-limit lock.
      if (updatePayload.status && updatePayload.status !== "paused") {
        const resumed = await withResumeWithinPlan(authCtx.organizationId, "monitor", id, writeMonitor);
        const refusal = resumeRefusalResponse(resumed);
        if (refusal) return refusal;
        updatedMonitor = resumed.ok ? resumed.value : null;
      } else {
        updatedMonitor = await db.transaction(writeMonitor);
      }
    } catch (error) {
      if (error instanceof InvalidNotificationProvidersError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Failed to update monitor, monitor not found after update." },
        { status: 404 },
      );
    }

    const oldFrequency = currentMonitor.frequencyMinutes;
    const newFrequency = updatedMonitor.frequencyMinutes;
    const oldStatus = currentMonitor.status;
    const newStatus = updatedMonitor.status;

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

    // Per-monitor lock and idempotent: a Redis failure leaves the saved row and answers 503 so a retry converges.
    let scheduleFailed = false;
    if (oldStatus !== newStatus || oldFrequency !== newFrequency || configChanged || targetChanged || typeChanged) {
      try {
        await reconcileMonitorSchedule(id, authCtx.project.id);
      } catch (error) {
        scheduleFailed = true;
        logger.error({ err: error, monitorId: id }, "Monitor saved but its schedule could not be updated");
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

    let rawData;
    try {
      rawData = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

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

    // Same name and target handling as create; credentials in config are never rewritten.
    sanitizeMonitorFields(rawData, rawData.type ?? currentMonitor.type);

    // Only a change to type or frequency is checked, so legacy sub-5-minute monitors can still be paused or renamed.
    const syntheticError = (rawData.type !== undefined || rawData.frequencyMinutes !== undefined) && syntheticFrequencyError(
      rawData.type ?? currentMonitor.type,
      rawData.frequencyMinutes ?? currentMonitor.frequencyMinutes,
    );
    if (syntheticError) {
      return NextResponse.json({ error: "Invalid frequency", details: syntheticError }, { status: 400 });
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
    if (rawData.name !== undefined && (typeof rawData.name !== "string" || !rawData.name.trim() || [...rawData.name].length > 255)) {
      return NextResponse.json({ error: "name must be 1-255 characters" }, { status: 400 });
    }
    const frequencyError = rawData.frequencyMinutes !== undefined ? frequencyMinutesError(rawData.frequencyMinutes) : null;
    if (frequencyError) return NextResponse.json({ error: frequencyError }, { status: 400 });
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
    if (rawData.config === null) {
      return NextResponse.json({ error: "config cannot be null" }, { status: 400 });
    }
    // Merge patch: objects merge, arrays replace, null deletes a key. PUT stays a full replace.
    if (rawData.config !== undefined) {
      updatePayload.config = isObject(rawData.config)
        ? mergePatch(currentMonitor.config ?? {}, rawData.config)
        : rawData.config;
    }

    if (rawData.config !== undefined || rawData.frequencyMinutes !== undefined) {
      const timeoutError = timeoutFrequencyError(
        updatePayload.config ?? currentMonitor.config,
        updatePayload.frequencyMinutes ?? currentMonitor.frequencyMinutes,
      );
      if (timeoutError) return NextResponse.json({ error: "Invalid configuration", details: timeoutError }, { status: 400 });
    }

    const configurationValidation = validateMonitorConfiguration({
      type: updatePayload.type ?? currentMonitor.type,
      target: updatePayload.target ?? currentMonitor.target,
      config: updatePayload.config ?? currentMonitor.config,
      incomingConfig: rawData.config,
    });
    if (!configurationValidation.success) {
      return NextResponse.json(configurationValidation, { status: 400 });
    }
    // Only a changed target or type is checked, so a monitor already pointing at an internal host stays editable.
    const effectiveU2 = { type: updatePayload.type ?? currentMonitor.type, target: updatePayload.target ?? currentMonitor.target };
    if (effectiveU2.type !== currentMonitor.type || effectiveU2.target !== currentMonitor.target) {
      const targetValidation = await validateMonitorTargetAddress(effectiveU2);
      if (!targetValidation.success) {
        return NextResponse.json(targetValidation, { status: 400 });
      }
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
    // null, false, 0 or "" would be silently ignored below, leaving alerts on: refuse them instead.
    if (rawData.alertConfig !== undefined && !isObject(rawData.alertConfig)) {
      return NextResponse.json({ error: "alertConfig must be an object" }, { status: 400 });
    }
    if (rawData.alertConfig) {
      // Same normaliser and rules as PUT, applied to the merged result.
      const normalized = normalizeMonitorAlertConfig(
        mergePatch(currentMonitor.alertConfig ?? {}, rawData.alertConfig),
      );
      const alertError = normalized.ok ? enabledAlertConfigError(normalized.value) : normalized.error;
      if (!normalized.ok || alertError) {
        return NextResponse.json({ error: alertError }, { status: 400 });
      }
      updatePayload.alertConfig = normalized.value;
      // A write that carries the provider list validates the ids and replaces the delivery rows in the same transaction as the row.
      if (alertProvidersSent(rawData.alertConfig)) providerIdsToSync = normalized.value.notificationProviders;
    }

    let updatedMonitor;
    let patchScheduleFailed = false;
    try {
      updatedMonitor = await updateMonitorHandler(
        id,
        updatePayload,
        providerIdsToSync
          ? { providerSync: { ids: providerIdsToSync, organizationId: authCtx.organizationId, projectId: authCtx.project.id } }
          : {},
      );
    } catch (error) {
      if (error instanceof ResumeRefusedError) return resumeRefusalResponse(error.outcome)!;
      if (error instanceof InvalidNotificationProvidersError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof MonitorScheduleError && error.monitor) {
        // Saved but not rescheduled: audit the change, then answer 503.
        updatedMonitor = error.monitor;
        patchScheduleFailed = true;
      } else {
        const scheduleFailure = scheduleFailureResponse(error);
        if (scheduleFailure) return scheduleFailure;
        const thrown = thrownStatusResponse(error);
        if (thrown) return thrown;
        throw error;
      }
    }

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

    if (patchScheduleFailed) return NextResponse.json({ error: SCHEDULE_FAILURE_MESSAGE }, { status: 503 });
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
      return NextResponse.json({ error: "Authentication required" }, { status: authErrorStatus(error) });
    }
    console.error("Error deleting monitor:", error);
    return NextResponse.json({ success: false, error: "Failed to delete monitor" }, { status: 500 });
  }
}
