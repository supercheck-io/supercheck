import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import {
  monitors,
  monitorResults,
  monitorsUpdateSchema,
  monitorNotificationSettings,
} from "@/db/schema";
import { MonitorType, MonitorStatus } from "@/db/schema/types";
import { eq, desc } from "drizzle-orm";
import {
  scheduleMonitor,
  deleteScheduledMonitor,
} from "@/lib/monitor-scheduler";
import { MonitorJobData } from "@/lib/queue";
import {
  requireAuth,
  hasPermission,
  getUserOrgRole,
} from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/admin";
import { logAuditEvent } from "@/lib/audit-logger";

// Hardcoded limit for charts and metrics display
// This is NOT for the table - table uses paginated /results endpoint
const RECENT_RESULTS_LIMIT = 100;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const { userId } = await requireAuth();

    // First, find the monitor without filtering by active project
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!monitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Check if user has access to this monitor
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin && monitor.organizationId && monitor.projectId) {
      // First, check if user is a member of the organization
      const orgRole = await getUserOrgRole(userId, monitor.organizationId);

      if (!orgRole) {
        return NextResponse.json(
          { error: "Access denied: Not a member of this organization" },
          { status: 403 }
        );
      }

      // Then check if they have permission to view monitors
      try {
        const canView = await hasPermission("monitor", "view", {
          organizationId: monitor.organizationId,
          projectId: monitor.projectId,
        });

        if (!canView) {
          return NextResponse.json(
            { error: "Insufficient permissions to view this monitor" },
            { status: 403 }
          );
        }
      } catch (permissionError) {
        // If permission check fails but user is org member, allow view access
        console.log(
          "Permission check failed, but user is org member:",
          permissionError
        );
      }
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
    console.error(`Error fetching monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to fetch monitor data" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const { userId } = await requireAuth();

    const rawData = await request.json();
    const validationResult = monitorsUpdateSchema.safeParse(rawData);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.format() },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;

    // First, find the monitor without filtering by active project
    const currentMonitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Now check if user has access to this monitor's project
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin) {
      if (!currentMonitor.organizationId || !currentMonitor.projectId) {
        return NextResponse.json(
          { error: "Monitor data incomplete" },
          { status: 500 }
        );
      }

      const canUpdate = await hasPermission("monitor", "update", {
        organizationId: currentMonitor.organizationId,
        projectId: currentMonitor.projectId,
      });

      if (!canUpdate) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
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

    const [updatedMonitor] = await db
      .update(monitors)
      .set(updatePayload)
      .where(eq(monitors.id, id))
      .returning();

    if (!updatedMonitor) {
      // Should not happen if currentMonitor was found, but as a safeguard
      return NextResponse.json(
        { error: "Failed to update monitor, monitor not found after update." },
        { status: 404 }
      );
    }

    // Update notification provider links if alert config is enabled
    if (
      rawData.alertConfig?.enabled &&
      Array.isArray(rawData.alertConfig.notificationProviders)
    ) {
      // First, delete existing links
      await db
        .delete(monitorNotificationSettings)
        .where(eq(monitorNotificationSettings.monitorId, id));

      // Then, create new links
      await Promise.all(
        rawData.alertConfig.notificationProviders.map((providerId: string) =>
          db.insert(monitorNotificationSettings).values({
            monitorId: id,
            notificationProviderId: providerId,
          })
        )
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
      },
      success: true,
    });

    return NextResponse.json(updatedMonitor);
  } catch (error) {
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
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { error: "Monitor ID is required" },
      { status: 400 }
    );
  }

  try {
    const { userId } = await requireAuth();

    const rawData = await request.json();

    // First, find the monitor without filtering by active project
    const currentMonitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });

    if (!currentMonitor) {
      return NextResponse.json({ error: "Monitor not found" }, { status: 404 });
    }

    // Now check if user has access to this monitor's project
    const userIsSuperAdmin = await isSuperAdmin();

    if (!userIsSuperAdmin) {
      if (!currentMonitor.organizationId || !currentMonitor.projectId) {
        return NextResponse.json(
          { error: "Monitor data incomplete" },
          { status: 500 }
        );
      }

      const canUpdate = await hasPermission("monitor", "update", {
        organizationId: currentMonitor.organizationId,
        projectId: currentMonitor.projectId,
      });

      if (!canUpdate) {
        return NextResponse.json(
          { error: "Insufficient permissions" },
          { status: 403 }
        );
      }
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
    console.error(`Error partially updating monitor ${id}:`, error);
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 }
    );
  }
}
