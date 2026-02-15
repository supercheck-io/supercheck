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
import { createS3CleanupService, type ReportDeletionInput } from "@/lib/s3-cleanup";

// Hardcoded limit for charts and metrics display
// This is NOT for the table - table uses paginated /results endpoint
const RECENT_RESULTS_LIMIT = 100;

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const context = await requireAuthContext();

    // Check permission via context (works for both session and CLI auth)
    const canView = checkPermissionWithContext("monitor", "view", context);
    if (!canView) {
      return NextResponse.json(
        { error: "Insufficient permissions to view this monitor" },
        { status: 403 }
      );
    }

    // Find the monitor scoped to current organization and project (defense-in-depth)
    const monitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, context.project.id),
        eq(monitors.organizationId, context.organizationId)
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

    // Ensure alertConfig has proper defaults if it's null or undefined
    const responseMonitor = {
      ...monitor,
      recentResults,
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
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error(`Error fetching monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to fetch monitor data" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const authCtx = await requireAuthContext();
    const userId = authCtx.userId;

    const rawData = await request.json();
    const validationResult = monitorsUpdateSchema.safeParse(rawData);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;

    // Check permission via context
    const canUpdate = checkPermissionWithContext("monitor", "update", authCtx);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Find the monitor scoped to current organization and project (defense-in-depth)
    const currentMonitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, authCtx.project.id),
        eq(monitors.organizationId, authCtx.organizationId)
      ),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Validate frequency bounds (1 minute minimum, 1440 minutes = 24 hours maximum)
    const MIN_FREQUENCY_MINUTES = 1;
    const MAX_FREQUENCY_MINUTES = 1440; // 24 hours
    
    if (rawData.frequencyMinutes !== undefined) {
      const freq = Number(rawData.frequencyMinutes);
      if (isNaN(freq) || freq < MIN_FREQUENCY_MINUTES || freq > MAX_FREQUENCY_MINUTES) {
        return NextResponse.json(
          {
            error: "Invalid frequency",
            details: `frequencyMinutes must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
          },
          { status: 400 }
        );
      }
    }

    // Validate alert configuration if enabled
    if (rawData.alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !rawData.alertConfig.notificationProviders ||
        rawData.alertConfig.notificationProviders.length === 0
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }

      // Check notification channel limit
      const maxMonitorChannels = parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (
        rawData.alertConfig.notificationProviders.length > maxMonitorChannels
      ) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxMonitorChannels} notification channels`,
          },
          { status: 400 }
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        rawData.alertConfig.alertOnFailure,
        rawData.alertConfig.alertOnRecovery,
        rawData.alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }
    }

    // Prepare update data - preserve existing alert config if not provided
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

    // Only update alertConfig if it's explicitly provided
    if (rawData.hasOwnProperty("alertConfig")) {
      updatePayload.alertConfig = rawData.alertConfig
        ? {
            enabled: Boolean(rawData.alertConfig.enabled),
            notificationProviders: Array.isArray(
              rawData.alertConfig.notificationProviders
            )
              ? rawData.alertConfig.notificationProviders
              : [],
            alertOnFailure:
              rawData.alertConfig.alertOnFailure !== undefined
                ? Boolean(rawData.alertConfig.alertOnFailure)
                : true,
            alertOnRecovery: Boolean(rawData.alertConfig.alertOnRecovery),
            alertOnSslExpiration: Boolean(
              rawData.alertConfig.alertOnSslExpiration
            ),
            failureThreshold:
              typeof rawData.alertConfig.failureThreshold === "number"
                ? rawData.alertConfig.failureThreshold
                : 1,
            recoveryThreshold:
              typeof rawData.alertConfig.recoveryThreshold === "number"
                ? rawData.alertConfig.recoveryThreshold
                : 1,
            customMessage:
              typeof rawData.alertConfig.customMessage === "string"
                ? rawData.alertConfig.customMessage
                : "",
          }
        : null;
    }
    // If alertConfig is not in rawData, existing alert settings are preserved

    const shouldSyncNotificationProviders =
      rawData.alertConfig?.enabled &&
      Array.isArray(rawData.alertConfig.notificationProviders);

    let normalizedProviderIds: string[] = [];
    if (shouldSyncNotificationProviders) {
      const rawProviderIds = rawData.alertConfig.notificationProviders as unknown[];

      normalizedProviderIds = Array.from(
        new Set(
          rawProviderIds.filter(
            (providerId: unknown): providerId is string =>
              typeof providerId === "string" && providerId.trim().length > 0
          )
        )
      );

      if (normalizedProviderIds.length !== rawProviderIds.length) {
        return NextResponse.json(
          {
            error: "Notification provider IDs must be non-empty strings",
          },
          { status: 400 }
        );
      }

      if (normalizedProviderIds.length > 0) {
        const validProviders = await db
          .select({ id: notificationProviders.id })
          .from(notificationProviders)
          .where(
            and(
              inArray(notificationProviders.id, normalizedProviderIds),
              eq(notificationProviders.organizationId, authCtx.organizationId),
              eq(notificationProviders.projectId, authCtx.project.id)
            )
          );

        if (validProviders.length !== normalizedProviderIds.length) {
          return NextResponse.json(
            {
              error:
                "One or more notification providers are invalid or not accessible in this project",
            },
            { status: 400 }
          );
        }
      }
    }

    const updatedMonitor = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(monitors)
        .set(updatePayload)
        .where(eq(monitors.id, id))
        .returning();

      if (!updated) {
        return null;
      }

      if (shouldSyncNotificationProviders) {
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
              }))
            )
            .onConflictDoNothing();
        }
      }

      return updated;
    });

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Failed to update monitor, monitor not found after update." },
        { status: 404 }
      );
    }

    // Handle scheduling changes for frequency updates
    const oldFrequency = currentMonitor.frequencyMinutes;
    const newFrequency = updatedMonitor.frequencyMinutes;
    const oldStatus = currentMonitor.status;
    const newStatus = updatedMonitor.status;

    const jobData: MonitorJobData = {
      monitorId: updatedMonitor.id,
      type: updatedMonitor.type as MonitorJobData["type"],
      target: updatedMonitor.target,
      config: updatedMonitor.config as Record<string, unknown>,
      frequencyMinutes: newFrequency ?? undefined,
    };

    // Handle status changes (pause/resume)
    if (oldStatus !== newStatus) {
      console.log(
        `Monitor ${id} status changed from ${oldStatus} to ${newStatus}`
      );

      if (newStatus === "paused") {
        // Pause monitor - remove from scheduler and clear scheduledJobId
        console.log(`Pausing monitor ${id} - removing from scheduler`);

        // Try both the stored scheduledJobId and the monitor ID
        let deleteSuccess = false;
        if (currentMonitor.scheduledJobId) {
          deleteSuccess = await deleteScheduledMonitor(
            currentMonitor.scheduledJobId
          );
        }

        if (!deleteSuccess) {
          deleteSuccess = await deleteScheduledMonitor(id);
        }

        // Clear the scheduled job ID from database
        await db
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(eq(monitors.id, id));
      } else if (
        oldStatus === "paused" &&
        (newStatus === "up" || newStatus === "down")
      ) {
        // Resume monitor - add to scheduler if it has valid frequency
        if (newFrequency && newFrequency > 0) {
          console.log(
            `Resuming monitor ${id} - adding to scheduler with ${newFrequency} minute frequency`
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
            .where(eq(monitors.id, id));
        }
      }
    }

    // Handle frequency changes for non-paused monitors OR config changes
    const configChanged =
      JSON.stringify(currentMonitor.config) !==
      JSON.stringify(updatedMonitor.config);
    const targetChanged = currentMonitor.target !== updatedMonitor.target;
    const typeChanged = currentMonitor.type !== updatedMonitor.type;
    
    // Track alert config changes for audit logging
    const alertConfigChanged =
      JSON.stringify(currentMonitor.alertConfig) !==
      JSON.stringify(updatedMonitor.alertConfig);
    const oldAlertConfig = currentMonitor.alertConfig as Record<string, unknown> | null;
    const newAlertConfig = updatedMonitor.alertConfig as Record<string, unknown> | null;

    if (
      (oldFrequency !== newFrequency ||
        configChanged ||
        targetChanged ||
        typeChanged) &&
      newStatus !== "paused"
    ) {
      // Always remove the old schedule first
      console.log(
        `Rescheduling monitor ${id} due to changes - frequency: ${oldFrequency} -> ${newFrequency}, config: ${configChanged}, target: ${targetChanged}, type: ${typeChanged}`
      );
      await deleteScheduledMonitor(id);

      if (newFrequency && newFrequency > 0) {
        console.log(`Scheduling monitor ${id} with updated configuration`);
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
          .where(eq(monitors.id, id));
      } else {
        console.log(
          `Monitor ${id} frequency set to ${newFrequency}, not scheduling.`
        );
        // Clear scheduler ID if frequency is 0 or null
        await db
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(eq(monitors.id, id));
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
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error(`Error updating monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 }
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
            source[key] as Record<string, unknown>
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
  routeContext: { params: Promise<{ id: string }> }
) {
  const params = await routeContext.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const authCtx = await requireAuthContext();
    const userId = authCtx.userId;

    const rawData = await request.json();

    // Check permission via context
    const canUpdate = checkPermissionWithContext("monitor", "update", authCtx);
    if (!canUpdate) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Find the monitor scoped to current organization and project (defense-in-depth)
    const currentMonitor = await db.query.monitors.findFirst({
      where: and(
        eq(monitors.id, id),
        eq(monitors.projectId, authCtx.project.id),
        eq(monitors.organizationId, authCtx.organizationId)
      ),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    const updatePayload: Partial<{
      config: typeof currentMonitor.config;
      alertConfig: typeof currentMonitor.alertConfig;
      status: typeof currentMonitor.status;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    // Handle partial update for 'config'
    if (rawData.config) {
      const newConfig = deepMerge(currentMonitor.config ?? {}, rawData.config);
      updatePayload.config = newConfig;
    }

    // Handle partial update for 'alertConfig'
    if (rawData.alertConfig) {
      const newAlertConfig = deepMerge(
        currentMonitor.alertConfig ?? {},
        rawData.alertConfig
      );
      updatePayload.alertConfig = newAlertConfig;
    }

    if (rawData.status) {
      updatePayload.status = rawData.status;
    }

    const [updatedMonitor] = await db
      .update(monitors)
      .set(updatePayload)
      .where(eq(monitors.id, id))
      .returning();

    if (!updatedMonitor) {
      return NextResponse.json(
        { error: "Failed to update monitor" },
        { status: 404 }
      );
    }

    // Handle pause/resume logic when status changes
    if (rawData.status && rawData.status !== currentMonitor.status) {
      console.log(
        `Monitor ${id} status changed from ${currentMonitor.status} to ${rawData.status}`
      );

      if (rawData.status === "paused") {
        // Pause monitor - remove from scheduler and clear scheduledJobId
        console.log(`[PATCH] Pausing monitor ${id} - removing from scheduler`);

        // Try both the stored scheduledJobId and the monitor ID
        let deleteSuccess = false;
        if (currentMonitor.scheduledJobId) {
          deleteSuccess = await deleteScheduledMonitor(
            currentMonitor.scheduledJobId
          );
        }

        if (!deleteSuccess) {
          deleteSuccess = await deleteScheduledMonitor(id);
        }

        // Clear the scheduled job ID from database
        await db
          .update(monitors)
          .set({ scheduledJobId: null })
          .where(eq(monitors.id, id));
      } else if (
        currentMonitor.status === "paused" &&
        (rawData.status === "up" || rawData.status === "down")
      ) {
        // Resume monitor - add to scheduler if it has valid frequency
        if (
          updatedMonitor.frequencyMinutes &&
          updatedMonitor.frequencyMinutes > 0
        ) {
          console.log(
            `Resuming monitor ${id} - adding to scheduler with ${updatedMonitor.frequencyMinutes} minute frequency`
          );

          const jobData: MonitorJobData = {
            monitorId: updatedMonitor.id,
            type: updatedMonitor.type as MonitorJobData["type"],
            target: updatedMonitor.target,
            config: updatedMonitor.config as Record<string, unknown>,
            frequencyMinutes: updatedMonitor.frequencyMinutes,
          };

          const schedulerId = await scheduleMonitor({
            monitorId: id,
            frequencyMinutes: updatedMonitor.frequencyMinutes,
            jobData,
            retryLimit: 3,
          });

          // Update monitor with new scheduler ID
          await db
            .update(monitors)
            .set({ scheduledJobId: schedulerId })
            .where(eq(monitors.id, id));
        }
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

    return NextResponse.json(updatedMonitor);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error(`Error partially updating monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/monitors/[id]
 * Deletes a monitor with full cleanup (scheduler, S3 reports, audit logging).
 * Mirrors the logic from the deleteMonitor server action.
 */
export async function DELETE(
  _request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await routeContext.params;
    const context = await requireAuthContext();
    const { userId, project, organizationId } = context;

    const canDelete = checkPermissionWithContext("monitor", "delete", context);
    if (!canDelete) {
      return NextResponse.json(
        { error: "Insufficient permissions to delete monitors" },
        { status: 403 }
      );
    }

    // Transaction: verify ownership, collect S3 report URLs, delete DB records
    const transactionResult = await db.transaction(async (tx) => {
      const [existingMonitor] = await tx
        .select({ id: monitors.id, name: monitors.name, type: monitors.type, target: monitors.target })
        .from(monitors)
        .where(
          and(
            eq(monitors.id, id),
            eq(monitors.projectId, project.id),
            eq(monitors.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!existingMonitor) {
        return { success: false as const, error: "Monitor not found" };
      }

      // Collect S3 report URLs for cleanup
      const resultsWithReports = await tx
        .select({ testReportS3Url: monitorResults.testReportS3Url })
        .from(monitorResults)
        .where(eq(monitorResults.monitorId, id));

      const reportInputs: ReportDeletionInput[] = resultsWithReports
        .filter((r) => !!r.testReportS3Url)
        .map((r) => ({
          s3Url: r.testReportS3Url || undefined,
          entityId: id,
          entityType: "monitor" as const,
        }));

      // Delete monitor results and the monitor itself
      await tx.delete(monitorResults).where(eq(monitorResults.monitorId, id));
      await tx.delete(monitors).where(eq(monitors.id, id));

      return {
        success: true as const,
        monitor: existingMonitor,
        reportInputs,
      };
    });

    if (!transactionResult.success) {
      return NextResponse.json(
        { error: transactionResult.error },
        { status: 404 }
      );
    }

    // Post-transaction cleanup (non-blocking)

    // Unschedule from Redis
    try {
      await deleteScheduledMonitor(id);
    } catch (err) {
      console.warn(`Failed to unschedule monitor ${id}:`, err);
    }

    // S3 cleanup (fire-and-forget)
    if (transactionResult.reportInputs.length > 0) {
      void (async () => {
        try {
          const s3 = createS3CleanupService();
          await s3.deleteReports(transactionResult.reportInputs);
        } catch (err) {
          console.warn(`S3 cleanup failed for monitor ${id}:`, err);
        }
      })();
    }

    await logAuditEvent({
      userId,
      organizationId,
      action: "monitor_deleted",
      resource: "monitor",
      resourceId: id,
      metadata: {
        monitorName: transactionResult.monitor.name,
        monitorType: transactionResult.monitor.type,
        monitorTarget: transactionResult.monitor.target,
        projectId: project.id,
      },
      success: true,
    });

    return NextResponse.json({ success: true, message: "Monitor deleted successfully" });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error deleting monitor:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
