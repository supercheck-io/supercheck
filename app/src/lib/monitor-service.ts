import { db } from "@/utils/db";
import {
  monitors as monitorTable,
  monitorsInsertSchema,
  MonitorConfig,
  MonitorType as DBMoniotorType,
  MonitorStatus as DBMonitorStatus,
  AlertConfig,
} from "@/db/schema";
import { MonitorJobData, addMonitorExecutionJobToQueue } from "@/lib/queue";
import {
  scheduleMonitor,
  deleteScheduledMonitor,
} from "@/lib/monitor-scheduler";
import { eq } from "drizzle-orm";

// This is a conceptual service layer, actual Next.js API routes would call these functions.
// Updated to support dual scoping (organization + project) for multi-tenant architecture.

interface MonitorApiData {
  name: string;
  description?: string | null;
  type: DBMoniotorType;
  target: string;
  frequencyMinutes: number;
  enabled?: boolean;
  config?: MonitorConfig | null;
  alertConfig?: AlertConfig | null; // Alert configuration for notifications
  organizationId: string; // Required for dual scoping
  projectId: string; // Required for dual scoping
  createdByUserId?: string; // Assuming this comes from authenticated session
}

export async function createMonitorHandler(data: MonitorApiData) {
  const validation = monitorsInsertSchema.safeParse(data);
  if (!validation.success) {
    throw {
      statusCode: 400,
      message: "Invalid monitor data",
      errors: validation.error.flatten(),
    };
  }

  const validatedData = validation.data;

  // Explicitly map fields to ensure only valid columns are passed
  const newMonitorData = {
    name: validatedData.name,
    description: validatedData.description,
    type: validatedData.type as DBMoniotorType,
    target: validatedData.target,
    frequencyMinutes: validatedData.frequencyMinutes,
    config: validatedData.config,
    alertConfig: validatedData.alertConfig,
    organizationId: validatedData.organizationId,
    projectId: validatedData.projectId,
    createdByUserId: validatedData.createdByUserId,
    status: (validatedData.enabled === false
      ? "paused"
      : "pending") as DBMonitorStatus,
    // id, createdAt, updatedAt are typically auto-generated or set by DB/Drizzle
  };

  const [newMonitor] = await db
    .insert(monitorTable)
    .values(newMonitorData) // Use the explicitly mapped data
    .returning();

  if (
    newMonitor &&
    validatedData.enabled !== false &&
    newMonitor.frequencyMinutes > 0
  ) {
    // Use validatedData.enabled here
    const jobDataPayload: MonitorJobData = {
      monitorId: newMonitor.id,
      type: newMonitor.type as MonitorJobData["type"],
      target: newMonitor.target,
      config: newMonitor.config as MonitorConfig,
      frequencyMinutes: newMonitor.frequencyMinutes,
    };
    try {
      const schedulerId = await scheduleMonitor({
        monitorId: newMonitor.id,
        frequencyMinutes: newMonitor.frequencyMinutes,
        jobData: jobDataPayload,
        retryLimit: 3,
      });

      // Update monitor with scheduler ID (like jobs do)
      await db
        .update(monitorTable)
        .set({ scheduledJobId: schedulerId })
        .where(eq(monitorTable.id, newMonitor.id));
    } catch (scheduleError) {
      console.error(
        `Failed to schedule monitor ${newMonitor.id} after creation:`,
        scheduleError
      );
      // Decide if this should be a hard error or just logged
    }

    // Trigger immediate execution for validation (non-blocking)
    triggerImmediateMonitorExecution(newMonitor.id).catch((error) => {
      console.error(
        `Failed to trigger immediate execution for monitor ${newMonitor.id}:`,
        error
      );
    });
  }
  return newMonitor;
}

export async function updateMonitorHandler(
  monitorId: string,
  data: Partial<MonitorApiData>
) {
  // Fetch existing monitor to compare old frequency/enabled status
  const existingMonitor = await db.query.monitors.findFirst({
    where: eq(monitorTable.id, monitorId),
  });

  if (!existingMonitor) {
    throw { statusCode: 404, message: "Monitor not found" };
  }

  // Create a payload with only the fields present in 'data' that are valid for update
  const updateData: Partial<typeof monitorTable.$inferInsert> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.type !== undefined) updateData.type = data.type as DBMoniotorType;
  if (data.target !== undefined) updateData.target = data.target;
  if (data.frequencyMinutes !== undefined)
    updateData.frequencyMinutes = data.frequencyMinutes;
  if (data.config !== undefined) updateData.config = data.config;
  if (data.alertConfig !== undefined) updateData.alertConfig = data.alertConfig;
  // Do not include organizationId or createdByUserId in updates usually, unless specifically intended

  updateData.updatedAt = new Date();

  // Handle status based on 'enabled'
  if (data.enabled === false) {
    updateData.status = "paused" as DBMonitorStatus;
  } else if (data.enabled === true && existingMonitor.status === "paused") {
    updateData.status = "pending" as DBMonitorStatus;
  }

  const [updatedMonitor] = await db
    .update(monitorTable)
    .set(updateData) // Use the filtered updateData
    .where(eq(monitorTable.id, monitorId))
    .returning();

  if (!updatedMonitor) {
    throw {
      statusCode: 404,
      message: "Monitor not found after update attempt",
    };
  }

  // Handle re-scheduling or unscheduling (like jobs do)
  const shouldReschedule =
    (data.frequencyMinutes !== undefined &&
      data.frequencyMinutes !== existingMonitor.frequencyMinutes) ||
    (data.enabled !== undefined && data.enabled !== existingMonitor.enabled);

  if (shouldReschedule) {
    // Remove existing schedule if any
    if (existingMonitor.scheduledJobId) {
      try {
        await deleteScheduledMonitor(existingMonitor.scheduledJobId);
      } catch (deleteError) {
        console.error(
          `Error deleting previous scheduler ${existingMonitor.scheduledJobId}:`,
          deleteError
        );
      }
    }

    if (
      updatedMonitor.enabled &&
      updatedMonitor.status !== "paused" &&
      updatedMonitor.frequencyMinutes > 0
    ) {
      const jobDataPayload: MonitorJobData = {
        monitorId: updatedMonitor.id,
        type: updatedMonitor.type as MonitorJobData["type"],
        target: updatedMonitor.target,
        config: updatedMonitor.config as MonitorConfig,
        frequencyMinutes: updatedMonitor.frequencyMinutes,
      };
      try {
        const schedulerId = await scheduleMonitor({
          monitorId: updatedMonitor.id,
          frequencyMinutes: updatedMonitor.frequencyMinutes,
          jobData: jobDataPayload,
          retryLimit: 3,
        });

        // Update monitor with new scheduler ID
        await db
          .update(monitorTable)
          .set({ scheduledJobId: schedulerId })
          .where(eq(monitorTable.id, updatedMonitor.id));

        // Trigger immediate execution for validation if monitor is enabled (non-blocking)
        triggerImmediateMonitorExecution(updatedMonitor.id).catch((error) => {
          console.error(
            `Failed to trigger immediate execution for updated monitor ${updatedMonitor.id}:`,
            error
          );
        });
      } catch (scheduleError) {
        console.error(
          `Failed to re-schedule monitor ${updatedMonitor.id} after update:`,
          scheduleError
        );
      }
    } else {
      // Clear scheduler ID if disabled or frequency is 0
      await db
        .update(monitorTable)
        .set({ scheduledJobId: null })
        .where(eq(monitorTable.id, updatedMonitor.id));
    }
  }
  return updatedMonitor;
}

export async function deleteMonitorHandler(monitorId: string) {
  // Remove scheduled job first (like jobs do)
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitorTable.id, monitorId),
  });

  if (monitor?.scheduledJobId) {
    try {
      await deleteScheduledMonitor(monitor.scheduledJobId);
    } catch (scheduleError) {
      console.warn(
        `Could not remove schedule for monitor ${monitorId} during deletion:`,
        scheduleError
      );
      // Continue with deletion even if unscheduling fails
    }
  }

  const [deletedMonitor] = await db
    .delete(monitorTable)
    .where(eq(monitorTable.id, monitorId))
    .returning();

  if (!deletedMonitor) {
    throw { statusCode: 404, message: "Monitor not found for deletion" };
  }
  return deletedMonitor;
}

/**
 * Trigger immediate execution of a monitor for validation/testing.
 */
export async function triggerImmediateMonitorExecution(monitorId: string) {
  console.log(
    `[IMMEDIATE_EXECUTION] Starting immediate execution for monitor ${monitorId}`
  );

  try {
    // Get monitor details
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitorTable.id, monitorId),
    });

    if (!monitor) {
      console.warn(`[IMMEDIATE_EXECUTION] Monitor ${monitorId} not found`);
      return;
    }

    console.log(
      `[IMMEDIATE_EXECUTION] Found monitor ${monitorId}: type=${monitor.type}, enabled=${monitor.enabled}, status=${monitor.status}`
    );

    // Skip disabled monitors
    if (!monitor.enabled || monitor.status === "paused") {
      console.log(
        `[IMMEDIATE_EXECUTION] Skipping disabled monitor ${monitorId} (enabled=${monitor.enabled}, status=${monitor.status})`
      );
      return;
    }

    const jobDataPayload: MonitorJobData = {
      monitorId: monitor.id,
      type: monitor.type as MonitorJobData["type"],
      target: monitor.target,
      config: monitor.config as MonitorConfig,
      frequencyMinutes: monitor.frequencyMinutes,
    };

    console.log(
      `[IMMEDIATE_EXECUTION] Adding monitor ${monitorId} to execution queue:`,
      {
        type: jobDataPayload.type,
        target: jobDataPayload.target,
        hasConfig: !!jobDataPayload.config,
      }
    );

    // Add to execution queue with immediate priority
    const jobId = await addMonitorExecutionJobToQueue(jobDataPayload);
    console.log(
      `[IMMEDIATE_EXECUTION] Successfully triggered execution for monitor ${monitorId} (jobId: ${jobId}, type: ${monitor.type})`
    );
  } catch (error) {
    console.error(
      `[IMMEDIATE_EXECUTION] Failed to trigger execution for monitor ${monitorId}:`,
      error
    );
    // Don't throw - immediate execution is a nice-to-have, not critical
  }
}
