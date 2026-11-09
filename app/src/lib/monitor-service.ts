import { isDeepStrictEqual } from "node:util";
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
import { ResumeRefusedError, withResumeWithinPlan } from "@/lib/middleware/plan-enforcement";
import { assertKeptProvidersValid, MonitorScheduleError, dropStaleSslAlertState, preserveWorkerConfigKeys, scheduleOutOfSync, syncMonitorProviderRows, WORKER_OWNED_CONFIG_KEYS } from "@/lib/monitor-write";
import { reconcileMonitorSchedule } from "@/lib/monitor-schedule-reconcile";

// This is a conceptual service layer, actual Next.js API routes would call these functions.
// Updated to support dual scoping (organization + project) for multi-tenant architecture.

interface MonitorApiData {
  name: string;
  description?: string | null;
  type: DBMoniotorType;
  target: string;
  frequencyMinutes: number;
  enabled?: boolean;
  status?: DBMonitorStatus;
  config?: MonitorConfig | null;
  alertConfig?: AlertConfig | null; // Alert configuration for notifications
  organizationId: string; // Required for dual scoping
  projectId: string; // Required for dual scoping
  createdByUserId?: string; // Assuming this comes from authenticated session
}

/** Anything that can run an insert: the global `db` or a transaction handle. */
type InsertExecutor = Pick<typeof db, "insert">;

/**
 * Validate and insert a monitor row only (no scheduling). Pass a transaction
 * as `executor` when the insert must commit together with a lock release.
 */
export async function insertMonitorRecord(
  data: MonitorApiData,
  executor: InsertExecutor = db
) {
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
    enabled: validatedData.enabled !== false,
    status: (validatedData.enabled === false
      ? "paused"
      : "pending") as DBMonitorStatus,
    // id, createdAt, updatedAt are typically auto-generated or set by DB/Drizzle
  };

  const [newMonitor] = await executor
    .insert(monitorTable)
    .values(newMonitorData) // Use the explicitly mapped data
    .returning();

  return { newMonitor, enabled: validatedData.enabled !== false };
}

/** Schedule a freshly committed monitor. Must run after the insert commits. */
export async function scheduleCreatedMonitor(
  newMonitor: typeof monitorTable.$inferSelect,
  enabled: boolean
) {
  if (
    newMonitor &&
    enabled &&
    newMonitor.frequencyMinutes > 0
  ) {
    // Use validatedData.enabled here
    const jobDataPayload: MonitorJobData = {
      monitorId: newMonitor.id,
      projectId: newMonitor.projectId ?? undefined,
      type: newMonitor.type as MonitorJobData["type"],
      target: newMonitor.target,
      config: newMonitor.config as MonitorConfig,
      frequencyMinutes: newMonitor.frequencyMinutes,
    };
    let schedulerId: string | undefined;
    try {
      schedulerId = await scheduleMonitor({
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
      // The caller deletes the row, so a repeatable job already queued would be orphaned.
      if (schedulerId) {
        try { await deleteScheduledMonitor(schedulerId); } catch { /* best effort; the original error is rethrown */ }
      }
      // An unscheduled monitor never runs and nothing reconciles it, so the caller must see the failure.
      throw scheduleError;
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

export async function createMonitorHandler(data: MonitorApiData) {
  const { newMonitor, enabled } = await insertMonitorRecord(data);
  return scheduleCreatedMonitor(newMonitor, enabled);
}

/** Config that changes what a check does. Alert channels, regions and bookkeeping must not reset the schedule. */
export function executionConfig(config: MonitorConfig | null | undefined) {
  return Object.fromEntries(Object.entries(config ?? {}).filter(([key]) =>
    !["locationConfig", "regions", "alertChannels", "testTitle", "retryStrategy", ...WORKER_OWNED_CONFIG_KEYS].includes(key)
  ));
}

export async function updateMonitorHandler(
  monitorId: string,
  data: Partial<MonitorApiData>,
  /** Delivery rows to replace in the same transaction as the monitor row (alertConfig writes). */
  options: { providerSync?: { ids: string[]; organizationId: string; projectId: string; storedIds?: string[] } } = {},
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
  if (data.config === null) throw { statusCode: 400, message: "config cannot be null" };
  if (data.config !== undefined) {
    // The worker owns alert dedupe state in config; a replacement must not reset it.
    data = { ...data, config: preserveWorkerConfigKeys(existingMonitor.config, data.config) };
    updateData.config = data.config;
  }
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.alertConfig !== undefined) updateData.alertConfig = data.alertConfig;
  // The saved settings decide whether a pending SSL renewed notice may still fire.
  if (data.config !== undefined || data.alertConfig !== undefined) {
    const effective = dropStaleSslAlertState(
      updateData.config ?? existingMonitor.config,
      updateData.alertConfig === undefined ? existingMonitor.alertConfig : updateData.alertConfig,
    );
    if (effective !== (updateData.config ?? existingMonitor.config)) updateData.config = effective;
  }
  // Do not include organizationId or createdByUserId in updates usually, unless specifically intended

  updateData.updatedAt = new Date();

  // Handle status based on 'enabled'
  if (data.enabled === false) {
    updateData.status = "paused" as DBMonitorStatus;
  } else if (data.enabled === true && existingMonitor.status === "paused") {
    updateData.status = "pending" as DBMonitorStatus;
  }

  if (data.status !== undefined) updateData.status = data.status;

  const { providerSync } = options;
  const writeUpdate = async (executor: Pick<typeof db, "update" | "select" | "delete" | "insert">) => {
    const rows = await executor
      .update(monitorTable)
      .set(updateData) // Use the filtered updateData
      .where(eq(monitorTable.id, monitorId))
      .returning();
    if (rows.length > 0 && providerSync) {
      const kept = await syncMonitorProviderRows(
        executor, monitorId, providerSync.ids, providerSync.organizationId, providerSync.projectId, providerSync.storedIds,
      );
      // A stored provider deleted since is dropped from the JSON too, so the UI and the rows agree.
      const written = rows[0].alertConfig;
      if (written && written.notificationProviders.length !== kept.length) {
        assertKeptProvidersValid(written, kept);
        rows[0] = { ...rows[0], alertConfig: { ...written, notificationProviders: kept } };
        await executor.update(monitorTable).set({ alertConfig: rows[0].alertConfig }).where(eq(monitorTable.id, monitorId));
      }
    }
    return rows;
  };
  // Turning a paused monitor back on takes a plan slot: count and write under the plan-limit lock.
  // Any non-paused status write goes through the lock: the status read above may be stale, and the helper takes no slot for a monitor already on.
  const resuming = updateData.status !== undefined && updateData.status !== "paused";
  let updatedRows;
  if (resuming && existingMonitor.organizationId) {
    const outcome = await withResumeWithinPlan(existingMonitor.organizationId, "monitor", monitorId, writeUpdate);
    if (!outcome.ok) throw new ResumeRefusedError(outcome);
    updatedRows = outcome.value;
  } else {
    updatedRows = providerSync ? await db.transaction(writeUpdate) : await writeUpdate(db);
  }
  const [updatedMonitor] = updatedRows;

  if (!updatedMonitor) {
    throw {
      statusCode: 404,
      message: "Monitor not found after update attempt",
    };
  }

  // Handle re-scheduling or unscheduling (like jobs do)
  const shouldReschedule =
    (data.status !== undefined && (data.status === "paused") !== (existingMonitor.status === "paused")) ||
    (data.frequencyMinutes !== undefined &&
      data.frequencyMinutes !== existingMonitor.frequencyMinutes) ||
    (data.enabled !== undefined && data.enabled !== existingMonitor.enabled) ||
    (data.type !== undefined && data.type !== existingMonitor.type) ||
    (data.target !== undefined && data.target !== existingMonitor.target) ||
    (data.config !== undefined && !isDeepStrictEqual(executionConfig(data.config), executionConfig(existingMonitor.config))) ||
    // An identical retry after a failed reconcile (503) must repair the schedule.
    scheduleOutOfSync(updatedMonitor);

  if (shouldReschedule) {
    // Under the per-monitor lock, from the committed row: a Redis failure throws MonitorScheduleError (the route answers 503).
    try {
      await reconcileMonitorSchedule(updatedMonitor.id, updatedMonitor.projectId ?? "");
    } catch (error) {
      console.error(`Failed to re-schedule monitor ${updatedMonitor.id} after update:`, error);
      throw new MonitorScheduleError(error, updatedMonitor);
    }
    if (updatedMonitor.enabled && updatedMonitor.status !== "paused" && updatedMonitor.frequencyMinutes > 0) {
      // Trigger immediate execution for validation (non-blocking)
      triggerImmediateMonitorExecution(updatedMonitor.id).catch((error) => {
        console.error(`Failed to trigger immediate execution for updated monitor ${updatedMonitor.id}:`, error);
      });
    }
  }
  return updatedMonitor;
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
      projectId: monitor.projectId ?? undefined,
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
