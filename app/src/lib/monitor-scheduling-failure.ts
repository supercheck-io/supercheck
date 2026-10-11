import type { LocationConfig, MonitorConfig, MonitoringLocation } from "@/db/schema";
import { monitors, monitorResults } from "@/db/schema";
import { db } from "@/utils/db";
import { desc, eq } from "drizzle-orm";
import { queueLogger as logger } from "@/lib/queue";
import { getFirstVisibleProjectRestrictionCode } from "@/lib/location-registry";
import { resolveDefaultMonitorLocations, resolveMonitorLocations } from "@/lib/monitor-location-routing";

/**
 * Mark a monitor as DOWN when the scheduler cannot enqueue execution jobs.
 *
 * In addition to updating the monitor status, we insert a monitor_results row
 * for the monitor's first configured location. Per-location failure history
 * remains available when workers recover. Multi-location alert counters advance
 * only when workers complete an evaluable cycle, not on failed publication.
 *
 * We use the monitor's actual configured location (not a synthetic
 * 'scheduler' location) to avoid polluting location-scoped queries.
 */
export async function recordSchedulingFailure(
  monitorId: string,
  errorMessage: string
): Promise<void> {
  try {
    const now = new Date();

    const monitor = await db.transaction(async (transaction) => {
      const [current] = await transaction.select({
        config: monitors.config, projectId: monitors.projectId, status: monitors.status,
      }).from(monitors).where(eq(monitors.id, monitorId)).for("update");
      if (!current) return;
      await transaction.update(monitors).set({
        status: 'down', lastCheckAt: now, updatedAt: now,
        lastStatusChangeAt: current.status === "down" ? undefined : now,
      }).where(eq(monitors.id, monitorId));
      return current;
    });
    if (!monitor) return;

    const monitorConfig = monitor?.config as MonitorConfig | null;
    const locationConfig = monitorConfig?.locationConfig as LocationConfig | null;
    const configuredLocations = locationConfig?.locations;

    // Read the latest result to maintain consecutive failure counting
    const lastResult = await db.query.monitorResults.findFirst({
      where: eq(monitorResults.monitorId, monitorId),
      orderBy: [desc(monitorResults.checkedAt)],
      columns: {
        location: true,
        isUp: true,
        consecutiveFailureCount: true,
        alertsSentForFailure: true,
      },
    });

    let location: MonitoringLocation | undefined;

    try {
      const resolvedLocations = await resolveMonitorLocations(
        locationConfig,
        monitor?.projectId ?? undefined
      );
      location = resolvedLocations[0] as MonitoringLocation | undefined;
    } catch {
      // Fall through to the configured/default/last-known fallback chain below.
    }

    if (!location && configuredLocations && configuredLocations.length > 0) {
      location = configuredLocations[0] as MonitoringLocation;
    }

    if (!location && monitor?.projectId) {
      location = (await getFirstVisibleProjectRestrictionCode(
        monitor.projectId
      )) as MonitoringLocation | undefined;
    }

    if (!location) {
      try {
        const defaultLocations = await resolveDefaultMonitorLocations(
          monitor?.projectId ?? undefined
        );
        location = defaultLocations[0] as MonitoringLocation | undefined;
      } catch {
        // Keep falling back.
      }
    }

    if (!location && lastResult?.location) {
      location = lastResult.location as MonitoringLocation;
    }

    if (!location) {
      logger.warn(
        { monitorId, errorMessage },
        "Scheduling failure — monitor marked as down without a result row because no valid location could be resolved"
      );
      return;
    }

    const consecutiveFailureCount = lastResult && !lastResult.isUp
      ? (lastResult.consecutiveFailureCount ?? 0) + 1
      : 1;
    const alertsSentForFailure = lastResult && !lastResult.isUp
      ? (lastResult.alertsSentForFailure ?? 0)
      : 0;
    const isStatusChange = lastResult ? lastResult.isUp : true;

    await db.insert(monitorResults).values({
      monitorId,
      checkedAt: now,
      location,
      status: 'error',
      isUp: false,
      isStatusChange,
      consecutiveFailureCount,
      consecutiveSuccessCount: 0,
      alertsSentForFailure,
      alertsSentForRecovery: 0,
      details: {
        errorMessage: `Scheduling failure: ${errorMessage}`,
      },
    });

    logger.warn(
      { monitorId, errorMessage, consecutiveFailureCount },
      `Scheduling failure — monitor marked as down with result row (location=${location})`
    );
  } catch (err) {
    logger.error(
      { monitorId, err },
      'Failed to record scheduling failure'
    );
  }
}
